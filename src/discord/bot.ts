/**
 * Главный Discord бот для синхронизации тикетов COINT
 */

import { Client, GatewayIntentBits, Events, type Message } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import { SiteApiClient } from '../api/site-client.js';
import { DiscordThreadManager } from './thread-manager.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { TicketMappingStore } from '../sync/mapping-store.js';
import { DedupeGuard } from '../sync/dedupe-guard.js';
import { StatsCollector } from '../stats/collector.js';
import { shouldIgnoreIncomingDiscordMessage } from '../sync/loop-guard.js';

export class TicketBot {
  private client: Client;
  private siteApi: SiteApiClient;
  private threadManager: DiscordThreadManager;
  private mappingStore: TicketMappingStore;
  private dedupeGuard: DedupeGuard;
  private syncEngine: SyncEngine;
  private statsCollector: StatsCollector;
  private cleanupInterval: NodeJS.Timeout | null = null;

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
    this.syncEngine = new SyncEngine(
      config,
      this.siteApi,
      this.threadManager,
      this.mappingStore,
      this.dedupeGuard,
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
        void this.handleButtonClick(interaction as never);
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
      const ticketNumber = this.mappingStore.getTicketByThread(threadId);

      if (!ticketNumber) {
        this.logger.trace(
          { threadId },
          'Message in non-ticket thread, ignoring'
        );
        return;
      }

      // Синхронизируем с сайтом
      await this.syncEngine.handleDiscordMessage(
        threadId,
        message.id,
        message.author.id,
        message.content
      );

      // TODO: Обрабатываем вложения
      if (message.attachments.size > 0) {
        this.logger.debug(
          {
            ticket: ticketNumber,
            attachmentCount: message.attachments.size,
          },
          'Message has attachments (not yet implemented)'
        );
      }
    } catch (error) {
      this.logger.error({ error, messageId: message.id }, 'Failed to handle message');
    }
  }

  private handleButtonClick(_interaction: never): void {
    this.logger.info('Button clicked (handler not yet implemented)');
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
  } {
    return {
      ready: this.client.isReady(),
      dryRun: this.config.dryRun,
      connectedGuilds: this.client.guilds.cache.size,
      mappings: this.mappingStore.getStats().totalMappings,
      dedupeRecords: this.dedupeGuard.getStats().totalRecords,
      statsMetrics: this.statsCollector.getModuleStats().totalMetrics,
    };
  }
}
