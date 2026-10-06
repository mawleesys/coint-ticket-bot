/**
 * Управление Discord форумами и тредами для тикетов
 */

import type { Logger } from 'pino';
import type {
  Client,
  ForumChannel,
  ForumThreadChannel,
  GuildForumTag,
  Message,
  EmbedBuilder as DiscordEmbedBuilder,
} from 'discord.js';
import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { Config } from '../config/index.js';
import {
  STATUS_TAG_NAMES,
  PRIORITY_TAG_NAMES,
  STATUS_COLORS,
  TicketButtonId,
  INTERNAL_NOTE_PREFIX,
  type TicketThreadCreateData,
  type TicketReplyData,
  type ThreadTagsUpdate,
} from '../types/discord.js';
import {
  TicketStatus,
  TicketPriority,
  TicketAuthorType,
} from '../types/api.js';
import { formatThreadTitle } from './event-mapper.js';
import { isConfidentialCategory } from '../routing/confidentiality.js';

export class DiscordThreadManager {
  private forumChannel: ForumChannel | null = null;
  private confidentialForumChannel: ForumChannel | null = null;
  private tagCache: Map<string, string> = new Map();

  constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  // ====================================
  // Initialization
  // ====================================

  async initialize(): Promise<void> {
    if (this.config.dryRun) {
      this.logger.info('[DRY RUN] Skipping Discord channel initialization');
      return;
    }

    const guild = await this.client.guilds.fetch(this.config.discord.guildId);

    // Основной форум
    const forumChannel = await guild.channels.fetch(
      this.config.discord.forumChannelId
    );
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
      throw new Error(
        `Channel ${this.config.discord.forumChannelId} is not a forum channel`
      );
    }
    this.forumChannel = forumChannel;

    // Конфиденциальный форум
    const confidentialChannel = await guild.channels.fetch(
      this.config.discord.confidentialForumChannelId
    );
    if (
      !confidentialChannel ||
      confidentialChannel.type !== ChannelType.GuildForum
    ) {
      throw new Error(
        `Channel ${this.config.discord.confidentialForumChannelId} is not a forum channel`
      );
    }
    this.confidentialForumChannel = confidentialChannel;

    // Кешируем теги
    this.cacheForumTags();

    this.logger.info('Discord thread manager initialized');
  }

  private cacheForumTags(): void {
    if (!this.forumChannel || !this.confidentialForumChannel) return;

    const cacheTags = (tags: ReadonlyArray<GuildForumTag>): void => {
      tags.forEach((tag) => {
        this.tagCache.set(tag.name, tag.id);
      });
    };

    cacheTags(this.forumChannel.availableTags);
    cacheTags(this.confidentialForumChannel.availableTags);

    this.logger.debug(
      { tagCount: this.tagCache.size },
      'Forum tags cached'
    );
  }

  // ====================================
  // Thread Creation
  // ====================================

  async createTicketThread(
    data: TicketThreadCreateData
  ): Promise<{ threadId: string; starterMessageId: string }> {
    const targetForum = data.isConfidential
      ? this.confidentialForumChannel
      : this.forumChannel;

    if (!targetForum) {
      throw new Error('Forum channel not initialized');
    }

    if (this.config.dryRun) {
      this.logger.info(
        { ticket: data.ticketNumber, confidential: data.isConfidential },
        '[DRY RUN] Would create ticket thread'
      );
      return {
        threadId: 'mock-thread-id',
        starterMessageId: 'mock-starter-id',
      };
    }

    const title = formatThreadTitle(data.ticketNumber, data.subject);
    const embed = this.buildTicketEmbed(data);
    const components = this.buildTicketButtons(data.status);
    const tags = this.selectThreadTags(data.status, data.priority, data.category);

    this.logger.info(
      {
        ticket: data.ticketNumber,
        title,
        tags: tags.length,
        confidential: data.isConfidential,
      },
      'Creating ticket thread'
    );

    const thread = await targetForum.threads.create({
      name: title,
      message: {
        embeds: [embed],
        components: components,
      },
      appliedTags: tags,
    });

    const starterMessage = await thread.fetchStarterMessage();

    return {
      threadId: thread.id,
      starterMessageId: starterMessage?.id || '',
    };
  }

  private buildTicketEmbed(data: TicketThreadCreateData): DiscordEmbedBuilder {
    const color = STATUS_COLORS[data.status];

    const embed = new EmbedBuilder()
      .setTitle(`Тикет ${data.ticketNumber}`)
      .setDescription(this.truncateText(data.firstMessage, 2000))
      .setColor(color)
      .setTimestamp()
      .addFields(
        { name: '📋 Категория', value: data.category, inline: true },
        {
          name: '🎯 Приоритет',
          value: PRIORITY_TAG_NAMES[data.priority],
          inline: true,
        },
        {
          name: '📊 Статус',
          value: STATUS_TAG_NAMES[data.status],
          inline: true,
        },
        { name: '👤 Автор', value: data.authorName, inline: true }
      );

    if (data.isConfidential) {
      embed.setFooter({ text: '🔒 Конфиденциально' });
    }

    return embed;
  }

  private buildTicketButtons(status: TicketStatus): ActionRowBuilder<ButtonBuilder>[] {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TicketButtonId.Take)
        .setLabel('Взять в работу')
        .setEmoji('👋')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(status === TicketStatus.Closed),

      new ButtonBuilder()
        .setCustomId(TicketButtonId.Resolve)
        .setLabel('Решить')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          status === TicketStatus.Resolved || status === TicketStatus.Closed
        ),

      new ButtonBuilder()
        .setCustomId(TicketButtonId.Close)
        .setLabel('Закрыть')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(status === TicketStatus.Closed)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TicketButtonId.PriorityLow)
        .setLabel('Низкий')
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(TicketButtonId.PriorityNormal)
        .setLabel('Обычный')
        .setEmoji('🟡')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(TicketButtonId.PriorityHigh)
        .setLabel('Высокий')
        .setEmoji('🟠')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(TicketButtonId.PriorityUrgent)
        .setLabel('Срочный')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
  }

  private selectThreadTags(
    status: TicketStatus,
    priority: TicketPriority,
    category: string
  ): string[] {
    const tags: string[] = [];

    const statusTag = this.tagCache.get(STATUS_TAG_NAMES[status]);
    if (statusTag) tags.push(statusTag);

    const priorityTag = this.tagCache.get(PRIORITY_TAG_NAMES[priority]);
    if (priorityTag) tags.push(priorityTag);

    // Опционально: тег категории (если создан в форуме)
    const categoryTag = this.tagCache.get(category);
    if (categoryTag) tags.push(categoryTag);

    // Discord позволяет максимум 5 тегов
    return tags.slice(0, 5);
  }

  // ====================================
  // Thread Updates
  // ====================================

  async updateThreadTags(
    threadId: string,
    updates: ThreadTagsUpdate
  ): Promise<void> {
    if (this.config.dryRun) {
      this.logger.info(
        { threadId, updates },
        '[DRY RUN] Would update thread tags'
      );
      return;
    }

    const thread = await this.getThread(threadId);
    if (!thread) return;

    const currentTags = thread.appliedTags;
    let newTags = [...currentTags];

    // Обновляем статус
    if (updates.status) {
      const oldStatusTags = Object.values(STATUS_TAG_NAMES)
        .map((name) => this.tagCache.get(name))
        .filter(Boolean);

      newTags = newTags.filter((tag) => !oldStatusTags.includes(tag));

      const newStatusTag = this.tagCache.get(STATUS_TAG_NAMES[updates.status]);
      if (newStatusTag) newTags.push(newStatusTag);
    }

    // Обновляем приоритет
    if (updates.priority) {
      const oldPriorityTags = Object.values(PRIORITY_TAG_NAMES)
        .map((name) => this.tagCache.get(name))
        .filter(Boolean);

      newTags = newTags.filter((tag) => !oldPriorityTags.includes(tag));

      const newPriorityTag = this.tagCache.get(
        PRIORITY_TAG_NAMES[updates.priority]
      );
      if (newPriorityTag) newTags.push(newPriorityTag);
    }

    await thread.setAppliedTags(newTags.slice(0, 5));

    this.logger.debug({ threadId, newTags: newTags.length }, 'Updated thread tags');
  }

  updateThreadButtons(
    starterMessageId: string,
    status: TicketStatus
  ): void {
    if (this.config.dryRun) {
      this.logger.info(
        { messageId: starterMessageId, status },
        '[DRY RUN] Would update thread buttons'
      );
      return;
    }

    // Находим сообщение и обновляем кнопки
    // Реализация зависит от того, как мы храним маппинг
    this.logger.debug({ starterMessageId, status }, 'Updating thread buttons');
  }

  // ====================================
  // Messages
  // ====================================

  async postReplyToThread(
    threadId: string,
    data: TicketReplyData
  ): Promise<string> {
    if (this.config.dryRun) {
      this.logger.info(
        { threadId, messageId: data.messageId },
        '[DRY RUN] Would post reply to thread'
      );
      return 'mock-discord-message-id';
    }

    const thread = await this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const content = this.formatReplyContent(data);
    const embed = this.buildReplyEmbed(data);

    const message = await thread.send({
      content: data.isInternal ? undefined : content,
      embeds: embed ? [embed] : undefined,
    });

    this.logger.debug(
      { threadId, discordMessageId: message.id, siteMessageId: data.messageId },
      'Posted reply to thread'
    );

    return message.id;
  }

  async postSystemNotice(threadId: string, text: string): Promise<void> {
    if (this.config.dryRun) {
      this.logger.info({ threadId, text }, '[DRY RUN] Would notify staff in thread');
      return;
    }

    const thread = await this.getThread(threadId);
    if (!thread) {
      this.logger.warn({ threadId }, 'Cannot post notice: thread not found');
      return;
    }

    await thread.send({ content: text });
  }

  private formatReplyContent(data: TicketReplyData): string {
    let prefix = '';

    if (data.isInternal) {
      prefix = '🔒 **[Внутренняя заметка]**\n';
    } else if (data.authorType === TicketAuthorType.User) {
      prefix = `💬 **${data.authorName || 'Игрок'}:**\n`;
    } else if (data.authorType === TicketAuthorType.Staff) {
      prefix = `👨‍💼 **${data.authorName || 'Персонал'}:**\n`;
    }

    return prefix + this.truncateText(data.body, 1900);
  }

  private buildReplyEmbed(data: TicketReplyData): DiscordEmbedBuilder | null {
    if (!data.isInternal) return null;

    return new EmbedBuilder()
      .setDescription(this.truncateText(data.body, 2000))
      .setColor(0x95a5a6)
      .setFooter({ text: `Автор: ${data.authorName || 'Система'}` });
  }

  // ====================================
  // Utilities
  // ====================================

  async getThread(threadId: string): Promise<ForumThreadChannel | null> {
    if (!this.forumChannel || !this.confidentialForumChannel) return null;

    try {
      const publicThread = await this.forumChannel.threads.fetch(threadId);
      if (publicThread) return publicThread;
    } catch {
      // Thread not in public forum
    }

    try {
      const confidentialThread =
        await this.confidentialForumChannel.threads.fetch(threadId);
      if (confidentialThread) return confidentialThread;
    } catch {
      // Thread not found
    }

    return null;
  }

  isMessageFromBot(message: Message): boolean {
    return message.author.id === this.client.user?.id;
  }

  isInternalNote(content: string): boolean {
    return content.trim().startsWith(INTERNAL_NOTE_PREFIX);
  }

  stripInternalNotePrefix(content: string): string {
    return content.replace(new RegExp(`^${INTERNAL_NOTE_PREFIX}\\s*`, 'i'), '');
  }

  isCategoryConfidential(categoryKey: string): boolean {
    return isConfidentialCategory(categoryKey);
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
