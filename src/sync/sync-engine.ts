/**
 * Движок синхронизации тикетов между сайтом и Discord
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import type { SiteApiClient } from '../api/site-client.js';
import type { DiscordThreadManager } from '../discord/thread-manager.js';
import type { TicketMappingStore } from './mapping-store.js';
import type { DedupeGuard } from './dedupe-guard.js';
import {
  TicketSource,
  type Ticket,
  type AddMessageRequest,
} from '../types/api.js';
import type {
  TicketThreadCreateData,
  TicketReplyData,
} from '../types/discord.js';
import { parseStaffThreadMessage } from '../discord/event-mapper.js';
import {
  isEmptyStaffBody,
  shouldSkipSiteEventToAvoidLoop,
} from './loop-guard.js';

export class SyncEngine {
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly siteApi: SiteApiClient,
    private readonly threadManager: DiscordThreadManager,
    private readonly mappingStore: TicketMappingStore,
    private readonly dedupeGuard: DedupeGuard,
    private readonly logger: Logger
  ) {}

  // ====================================
  // Lifecycle
  // ====================================

  start(): void {
    if (this.config.dryRun) {
      this.logger.info('[DRY RUN] Sync engine would start polling');
      return;
    }

    const intervalMs = this.config.sync.pollInterval * 1000;

    this.syncInterval = setInterval(() => {
      void this.syncSiteToDiscord();
    }, intervalMs);

    this.logger.info(
      { intervalSeconds: this.config.sync.pollInterval },
      'Sync engine started'
    );
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      this.logger.info('Sync engine stopped');
    }
  }

  // ====================================
  // Site → Discord Sync
  // ====================================

  /**
   * Синхронизация сайт → Discord
   * ВАЖНО: Временная реализация через polling до реализации outbox/webhook
   * См. gap #4 в спецификации
   */
  syncSiteToDiscord(): void {
    if (this.config.dryRun) {
      this.logger.debug('[DRY RUN] Would poll site for changes');
      return;
    }

    this.logger.debug('Starting site → Discord sync cycle');

    try {
      // TODO: Когда сайт реализует /events endpoint:
      // const events = await this.siteApi.getEventsSince(lastEventId);
      // for (const event of events) {
      //   await this.handleSiteEvent(event);
      // }

      // Пока что это заглушка
      this.logger.trace('Site → Discord sync: no events API available');
    } catch (error) {
      this.logger.error({ error }, 'Site → Discord sync failed');
    }
  }

  /**
   * Создает тред для нового тикета с сайта
   */
  async mirrorTicketToDiscord(ticket: Ticket): Promise<void> {
    // Проверяем, не создан ли уже тред
    if (this.mappingStore.hasTicket(ticket.public_number)) {
      this.logger.debug(
        { ticket: ticket.public_number },
        'Thread already exists'
      );
      return;
    }

    // Определяем, конфиденциальный ли это тикет
    const isConfidential = this.threadManager.isCategoryConfidential(
      ticket.category
    );

    // Формируем данные для создания треда
    const firstMessage =
      ticket.messages.find((m) => !m.is_internal)?.body || '';

    const threadData: TicketThreadCreateData = {
      ticketNumber: ticket.public_number,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      authorName: 'Игрок', // TODO: получать через API когда появится endpoint
      firstMessage,
      isConfidential,
    };

    // Создаем тред
    const { threadId, starterMessageId } =
      await this.threadManager.createTicketThread(threadData);

    // Сохраняем маппинг
    this.mappingStore.set({
      ticketNumber: ticket.public_number,
      threadId,
      channelId: isConfidential
        ? this.config.discord.confidentialForumChannelId
        : this.config.discord.forumChannelId,
      starterMessageId,
      isConfidential,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Регистрируем reference на сайте
    await this.siteApi.addReference(ticket.public_number, {
      provider: 'discord',
      external_type: 'thread',
      external_id: threadId,
      metadata: {
        starter_message_id: starterMessageId,
        confidential: isConfidential,
      },
    });

    this.logger.info(
      {
        ticket: ticket.public_number,
        threadId,
        confidential: isConfidential,
      },
      'Mirrored ticket to Discord'
    );
  }

  /**
   * Отправляет новое сообщение с сайта в Discord тред
   */
  async mirrorMessageToDiscord(
    ticketNumber: string,
    messageId: number
  ): Promise<void> {
    const mapping = this.mappingStore.getByTicket(ticketNumber);
    if (!mapping) {
      this.logger.warn(
        { ticket: ticketNumber },
        'Cannot mirror message: thread not found'
      );
      return;
    }

    // Получаем тикет с сайта
    const ticket = await this.siteApi.getTicket(ticketNumber, true);

    // Находим новое сообщение
    const message = ticket.messages.find((m) => m.id === messageId);
    if (!message) {
      this.logger.warn({ ticket: ticketNumber, messageId }, 'Message not found');
      return;
    }

    if (
      shouldSkipSiteEventToAvoidLoop({
        source: message.source,
        externalMessageId: message.external_message_id,
      })
    ) {
      this.logger.debug(
        { ticket: ticketNumber, messageId },
        'Skipping Discord-sourced message to avoid loop'
      );
      return;
    }

    // Проверяем dedupe
    if (
      message.external_message_id &&
      this.dedupeGuard.isProcessed(message.external_message_id)
    ) {
      this.logger.debug(
        { ticket: ticketNumber, messageId },
        'Message already processed'
      );
      return;
    }

    // Отправляем в Discord
    const replyData: TicketReplyData = {
      messageId: message.id,
      body: message.body,
      authorType: message.author_type,
      isInternal: message.is_internal,
      source: message.source,
    };

    const discordMessageId = await this.threadManager.postReplyToThread(
      mapping.threadId,
      replyData
    );

    // Помечаем как обработанное
    if (message.external_message_id) {
      this.dedupeGuard.markProcessed(message.external_message_id);
    }

    // Обновляем lastSyncedMessageId
    this.mappingStore.updateLastSyncedMessage(ticketNumber, messageId);

    this.logger.info(
      {
        ticket: ticketNumber,
        siteMessageId: messageId,
        discordMessageId,
      },
      'Mirrored message to Discord'
    );
  }

  /**
   * Обновляет теги треда при изменении статуса/приоритета
   */
  async updateThreadFromTicket(ticket: Ticket): Promise<void> {
    const mapping = this.mappingStore.getByTicket(ticket.public_number);
    if (!mapping) return;

    await this.threadManager.updateThreadTags(mapping.threadId, {
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
    });

    this.logger.debug(
      { ticket: ticket.public_number },
      'Updated thread from ticket'
    );
  }

  // ====================================
  // Discord → Site Sync
  // ====================================

  /**
   * Обрабатывает сообщение из Discord и отправляет на сайт
   */
  async handleDiscordMessage(
    threadId: string,
    messageId: string,
    _authorId: string,
    content: string
  ): Promise<void> {
    const ticketNumber = this.mappingStore.getTicketByThread(threadId);
    if (!ticketNumber) {
      this.logger.debug({ threadId }, 'Message in non-ticket thread, ignoring');
      return;
    }

    // Проверяем dedupe
    if (this.dedupeGuard.isProcessed(messageId)) {
      this.logger.debug({ messageId }, 'Discord message already processed');
      return;
    }

    // TODO: Резолвим Discord user → site user через API (gap #6)
    // const siteUser = await this.siteApi.getUserByDiscordId(authorId);
    // if (!siteUser) {
    //   await this.sendUserNotLinkedMessage(threadId);
    //   return;
    // }

    // Временная заглушка: используем фиктивный user_id
    const siteUserId = 1; // TODO: реальный lookup

    const parsed = parseStaffThreadMessage(content);
    if (isEmptyStaffBody(parsed.body)) {
      this.logger.debug({ messageId }, 'Ignoring empty Discord message');
      return;
    }

    const request: AddMessageRequest = {
      user_id: siteUserId,
      body: parsed.body,
      is_internal: parsed.isInternal,
      external_message_id: messageId,
      source: TicketSource.Discord,
    };

    try {
      const response = await this.siteApi.addMessage(ticketNumber, request);

      // Помечаем как обработанное
      this.dedupeGuard.markProcessed(messageId);

      // Обновляем lastSyncedMessageId
      this.mappingStore.updateLastSyncedMessage(ticketNumber, response.id);

      this.logger.info(
        {
          ticket: ticketNumber,
          discordMessageId: messageId,
          siteMessageId: response.id,
          isInternal: parsed.isInternal,
        },
        'Synced Discord message to site'
      );
    } catch (error) {
      this.logger.error(
        { error, ticket: ticketNumber, messageId },
        'Failed to sync Discord message to site'
      );
      throw error;
    }
  }

  /**
   * Обрабатывает изменение статуса через кнопку Discord
   */
  async handleStatusButton(
    threadId: string,
    userId: string,
    newStatus: string
  ): Promise<void> {
    const ticketNumber = this.mappingStore.getTicketByThread(threadId);
    if (!ticketNumber) return;

    // TODO: Резолвим Discord user → site user
    const siteUserId = 1;

    await this.siteApi.changeStatus(ticketNumber, {
      status: newStatus as never,
      user_id: siteUserId,
    });

    this.logger.info(
      { ticket: ticketNumber, newStatus, userId },
      'Changed ticket status from Discord'
    );
  }
}
