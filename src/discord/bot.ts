/**
 * Главный Discord бот для синхронизации тикетов COINT
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import { SiteApiClient } from '../api/site-client.js';
import { DiscordThreadManager } from './thread-manager.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { TicketMappingStore } from '../sync/mapping-store.js';
import { DedupeGuard } from '../sync/dedupe-guard.js';
import { StatsCollector } from '../stats/collector.js';
import { EventCursorStore } from '../sync/event-cursor.js';
import { shouldIgnoreIncomingDiscordMessage } from '../sync/loop-guard.js';

export class TicketBot {
  private client: Client;
  private siteApi: SiteApiClient;
  private threadManager: DiscordThreadManager;
  private mappingStore: TicketMappingStore;
  private dedupeGuard: DedupeGuard;
  private syncEngine: SyncEngine;
  private statsCollector: StatsCollector;
  private cursorStore: EventCursorStore;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private lastWeeklyKey: string | null = null;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.siteApi = new SiteApiClient(config, logger.child({ module: 'siteApi' }));
    this.mappingStore = new TicketMappingStore(
      logger.child({ module: 'mappingStore' })
    );
    this.dedupeGuard = new DedupeGuard(logger.child({ module: 'dedupeGuard' }));
    this.threadManager = new DiscordThreadManager(
      this.client,
      config,
      logger.child({ module: 'threadManager' })
    );
    this.statsCollector = new StatsCollector(
      config,
      logger.child({ module: 'stats' })
    );
    this.cursorStore = new EventCursorStore(
      config.dryRun ? null : config.sync.cursorPath,
      logger.child({ module: 'eventCursor' })
    );
    this.syncEngine = new SyncEngine(
      config,
      this.siteApi,
      this.threadManager,
      this.mappingStore,
      this.dedupeGuard,
      this.cursorStore,
      logger.child({ module: 'syncEngine' })
    );
  }

  // ====================================
  // Lifecycle
  // ====================================

  async start(): Promise<void> {
    this.setupEventHandlers();

    if (this.config.dryRun) {
      this.logger.info('[DRY RUN] Bot initialized without connecting to Discord');
      this.logger.info({
        guild: this.config.discord.guildId,
        forumChannel: this.config.discord.forumChannelId,
        confidentialChannel: this.config.discord.confidentialForumChannelId,
      }, 'Would connect to Discord with config');
      return;
    }

    await this.client.login(this.config.discord.token);
  }

  async stop(): Promise<void> {
    this.syncEngine.stop();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (!this.config.dryRun) {
      await this.client.destroy();
    }

    this.logger.info('Bot stopped');
  }

  // ====================================
  // Event Handlers
  // ====================================

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      this.logger.info(
        { user: client.user.tag, guilds: client.guilds.cache.size },
        'Bot connected to Discord'
      );

      this.threadManager.initialize()
        .then(() => {
          this.syncEngine.start();
          this.cleanupInterval = this.dedupeGuard.startCleanupInterval();
          this.startWeeklyStatsScheduler();
          this.logger.info('Bot fully initialized and ready');
        })
        .catch((error) => {
          this.logger.error({ error }, 'Failed to initialize bot');
          throw error;
        });
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonClick(interaction);
      }
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error({ error }, 'Discord client error');
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    try {
      if (
        shouldIgnoreIncomingDiscordMessage(
          {
            id: message.id,
            content: message.content,
            author: {
              id: message.author.id,
              bot: message.author.bot,
              webhookId: message.webhookId,
              system: message.system,
            },
          },
          this.client.user?.id
        )
      ) {
        return;
      }

      if (!message.channel.isThread()) return;

      const threadId = message.channel.id;
      const result = await this.syncEngine.handleDiscordMessage(
        threadId,
        message.id,
        message.author.id,
        message.content
      );

      if (result.notice) {
        return;
      }

      if (message.attachments.size > 0) {
        this.logger.debug(
          {
            threadId,
            attachmentCount: message.attachments.size,
          },
          'Message has attachments (not yet implemented)'
        );
      }
    } catch (error) {
      this.logger.error({ error, messageId: message.id }, 'Failed to handle message');
    }
  }

  private async handleButtonClick(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: 'Кнопки тикета работают только внутри треда.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await this.syncEngine.handleTicketButton(
        interaction.channel.id,
        interaction.user.id,
        interaction.customId
      );
      await interaction.editReply({
        content: result.notice ?? 'Готово.',
      });
    } catch (error) {
      this.logger.error(
        { error, customId: interaction.customId },
        'Failed to handle ticket button'
      );
      await interaction.editReply({
        content: 'Не удалось выполнить действие. Попробуйте позже.',
      });
    }
  }

  private startWeeklyStatsScheduler(): void {
    if (!this.config.stats.enabled) {
      return;
    }

    this.statsInterval = setInterval(() => {
      void this.maybePostWeeklyStats();
    }, 60 * 60 * 1000);

    void this.maybePostWeeklyStats();
  }

  private async maybePostWeeklyStats(): Promise<void> {
    if (!this.config.stats.enabled) {
      return;
    }

    const now = new Date();
    if (now.getUTCDay() !== this.config.stats.weeklyReportDay) {
      return;
    }
    if (now.getUTCHours() !== this.config.stats.weeklyReportHour) {
      return;
    }

    const key = now.toISOString().slice(0, 10);
    if (this.lastWeeklyKey === key) {
      return;
    }
    this.lastWeeklyKey = key;

    try {
      const summary = await this.statsCollector.getWeeklySummary(
        this.siteApi,
        this.config.site.actorUserId
      );
      this.logger.info(
        { source: summary.source, preview: summary.text.slice(0, 80) },
        'Weekly support stats ready'
      );

      const channelId = this.config.discord.statsChannelId;
      if (!channelId || this.config.dryRun) {
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (
        channel &&
        'send' in channel &&
        typeof channel.send === 'function'
      ) {
        await channel.send({ content: summary.text.slice(0, 2000) });
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to publish weekly stats');
    }
  }

  // ====================================
  // Status & Health
  // ====================================

  getStatus(): {
    ready: boolean;
    dryRun: boolean;
    connectedGuilds: number;
    mappings: number;
    dedupeRecords: number;
    statsMetrics: number;
    eventCursor: number;
  } {
    return {
      ready: this.client.isReady(),
      dryRun: this.config.dryRun,
      connectedGuilds: this.client.guilds.cache.size,
      mappings: this.mappingStore.getStats().totalMappings,
      dedupeRecords: this.dedupeGuard.getStats().totalRecords,
      statsMetrics: this.statsCollector.getModuleStats().totalMetrics,
      eventCursor: this.cursorStore.get(),
    };
  }
}
