/**
 * Двусторонняя синхронизация: outbox сайта → Discord и сообщения Discord → сайт.
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import type { SiteApiClient } from '../api/site-client.js';
import type { DiscordThreadManager } from '../discord/thread-manager.js';
import type { TicketMappingStore } from './mapping-store.js';
import type { DedupeGuard } from './dedupe-guard.js';
import type { EventCursorStore } from './event-cursor.js';
import {
  TicketApiError,
  TicketSource,
  TicketStatus,
  type AddMessageRequest,
  type OutboxEvent,
  type Ticket,
} from '../types/api.js';
import type {
  TicketThreadCreateData,
  TicketReplyData,
} from '../types/discord.js';
import { parseStaffThreadMessage } from '../discord/event-mapper.js';
import { isTicketConfidential } from '../routing/confidentiality.js';
import {
  isEmptyStaffBody,
  shouldSkipSiteEventToAvoidLoop,
} from './loop-guard.js';
import {
  isCreatedEvent,
  isMessageEvent,
  isStateEvent,
  messageIsInternal,
  shouldSkipMirrorEvent,
} from './event-feed.js';
import {
  messageForForbidden,
  resolveStaffFromDiscord,
  type StaffAction,
} from './staff-resolver.js';
import { actionFromTicketButton } from './ticket-actions.js';
import { daysAgo, needsResync, toDateOnly } from './resync.js';

export class SyncEngine {
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly siteApi: SiteApiClient,
    private readonly threadManager: DiscordThreadManager,
    private readonly mappingStore: TicketMappingStore,
    private readonly dedupeGuard: DedupeGuard,
    private readonly cursorStore: EventCursorStore,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (this.config.dryRun) {
      this.logger.info(
        { afterId: this.cursorStore.get() },
        '[DRY RUN] Sync engine would poll GET /events and resync if the cursor is stale'
      );
      return;
    }

    const intervalMs = this.config.sync.pollInterval * 1000;
    this.syncInterval = setInterval(() => {
      void this.syncSiteToDiscord();
    }, intervalMs);

    void this.syncSiteToDiscord();
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

  async syncSiteToDiscord(): Promise<void> {
    if (this.config.dryRun) {
      this.logger.debug(
        { afterId: this.cursorStore.get() },
        '[DRY RUN] Would poll GET /events?after_id='
      );
      return;
    }

    if (!this.config.features.siteEventFeed) {
      this.logger.debug('Event feed disabled by FEATURE_SITE_EVENT_FEED=false');
      return;
    }

    try {
      if (await this.cursorNeedsResync()) {
        await this.resyncFromList();
      }

      let hasMore = true;
      while (hasMore) {
        const page = await this.siteApi.getEvents(
          this.cursorStore.get(),
          this.config.sync.eventsLimit
        );

        for (const event of page.data) {
          await this.handleSiteEvent(event);
          this.cursorStore.set(event.id);
        }

        if (page.next_after_id > this.cursorStore.get()) {
          this.cursorStore.set(page.next_after_id);
        }

        hasMore = page.has_more && page.data.length > 0;
      }

      this.cursorStore.markSynced();
    } catch (error) {
      this.logger.error({ error }, 'Site → Discord sync failed');
    }
  }

  private async cursorNeedsResync(): Promise<boolean> {
    const peek = await this.siteApi.getEvents(0, 1);
    const oldest = peek.data[0]?.id ?? null;
    return needsResync({
      afterId: this.cursorStore.get(),
      lastSyncAt: this.cursorStore.getLastSyncAt(),
      oldestEventId: oldest,
      retentionDays: this.config.sync.outboxRetentionDays,
    });
  }

  private async resyncFromList(): Promise<void> {
    const userId = this.config.site.actorUserId;
    this.logger.warn(
      {
        afterId: this.cursorStore.get(),
        lastSyncAt: this.cursorStore.getLastSyncAt()?.toISOString() ?? null,
        actorUserId: userId ?? null,
      },
      'Outbox cursor stale — resync via GET / + GET /{ticket}'
    );

    if (!this.config.features.ticketList || !userId) {
      this.logger.warn(
        'Cannot list tickets for resync (need FEATURE_TICKET_LIST and SITE_ACTOR_USER_ID)'
      );
      await this.jumpCursorToLatest();
      return;
    }

    const from = toDateOnly(daysAgo(this.config.sync.outboxRetentionDays));
    let page = 1;
    let lastPage = 1;

    do {
      const result = await this.siteApi.listTickets({
        user_id: userId,
        queue: 'all',
        from,
        page,
        per_page: 100,
      });

      for (const item of result.data) {
        const ticket = await this.siteApi.getTicket(item.public_number, true);
        if (this.mappingStore.hasTicket(ticket.public_number)) {
          await this.updateThreadFromTicket(ticket);
        } else {
          await this.mirrorTicketToDiscord(ticket);
        }
      }

      lastPage = result.meta.last_page;
      page += 1;
    } while (page <= lastPage);

    await this.jumpCursorToLatest();
  }

  private async jumpCursorToLatest(): Promise<void> {
    let after = 0;
    let hasMore = true;

    while (hasMore) {
      const page = await this.siteApi.getEvents(after, 500);
      if (page.next_after_id > after) {
        after = page.next_after_id;
      }
      hasMore = page.has_more && page.data.length > 0;
      if (page.data.length === 0) {
        break;
      }
    }

    this.cursorStore.set(after);
    this.cursorStore.markSynced();
  }

  async handleSiteEvent(event: OutboxEvent): Promise<void> {
    if (shouldSkipMirrorEvent(event)) {
      this.logger.debug(
        {
          eventId: event.id,
          type: event.event_type,
          source: event.source,
        },
        'Skipping site event (discord source or non-feed type)'
      );
      return;
    }

    if (isCreatedEvent(event)) {
      const ticket = await this.siteApi.getTicket(event.ticket_number, true);
      await this.mirrorTicketToDiscord(ticket);
      return;
    }

    if (isMessageEvent(event) && event.message_id) {
      await this.mirrorMessageToDiscord(
        event.ticket_number,
        event.message_id,
        messageIsInternal(event)
      );
      return;
    }

    if (isStateEvent(event)) {
      const ticket = await this.siteApi.getTicket(event.ticket_number);
      await this.updateThreadFromTicket(ticket);
    }
  }

  async mirrorTicketToDiscord(ticket: Ticket): Promise<void> {
    if (this.mappingStore.hasTicket(ticket.public_number)) {
      this.logger.debug({ ticket: ticket.public_number }, 'Thread already exists');
      return;
    }

    const isConfidential = isTicketConfidential(ticket);
    const firstMessage =
      ticket.messages.find((message) => !message.is_internal)?.body || '';

    const threadData: TicketThreadCreateData = {
      ticketNumber: ticket.public_number,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      authorName: ticket.owner_user_id
        ? `Игрок #${ticket.owner_user_id}`
        : 'Игрок',
      firstMessage,
      isConfidential,
    };

    const { threadId, starterMessageId } =
      await this.threadManager.createTicketThread(threadData);

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
      { ticket: ticket.public_number, threadId, confidential: isConfidential },
      'Mirrored ticket to Discord'
    );
  }

  async mirrorMessageToDiscord(
    ticketNumber: string,
    messageId: number,
    includeInternal = true
  ): Promise<void> {
    const mapping = this.mappingStore.getByTicket(ticketNumber);
    if (!mapping) {
      const ticket = await this.siteApi.getTicket(ticketNumber, true);
      await this.mirrorTicketToDiscord(ticket);
    }

    const resolved = this.mappingStore.getByTicket(ticketNumber);
    if (!resolved) {
      this.logger.warn({ ticket: ticketNumber }, 'Cannot mirror message: no thread');
      return;
    }

    const ticket = await this.siteApi.getTicket(ticketNumber, includeInternal);
    const message = ticket.messages.find((item) => item.id === messageId);
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

    if (
      message.external_message_id &&
      this.dedupeGuard.isProcessed(message.external_message_id)
    ) {
      return;
    }

    const replyData: TicketReplyData = {
      messageId: message.id,
      body: message.body,
      authorType: message.author_type,
      authorName: message.author_user_id
        ? `user#${message.author_user_id}`
        : undefined,
      isInternal: message.is_internal,
      source: message.source,
    };

    const discordMessageId = await this.threadManager.postReplyToThread(
      resolved.threadId,
      replyData
    );

    if (message.external_message_id) {
      this.dedupeGuard.markProcessed(message.external_message_id);
    }
    this.mappingStore.updateLastSyncedMessage(ticketNumber, messageId);

    this.logger.info(
      { ticket: ticketNumber, siteMessageId: messageId, discordMessageId },
      'Mirrored message to Discord'
    );
  }

  async updateThreadFromTicket(ticket: Ticket): Promise<void> {
    const mapping = this.mappingStore.getByTicket(ticket.public_number);
    if (!mapping) {
      return;
    }

    await this.threadManager.updateThreadTags(mapping.threadId, {
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
    });
  }

  /**
   * Тикет по треду: сначала память, затем GET /by-reference.
   */
  async resolveTicketNumber(
    threadId: string,
    viewerUserId?: number
  ): Promise<string | undefined> {
    const mapped = this.mappingStore.getTicketByThread(threadId);
    if (mapped) {
      return mapped;
    }

    try {
      const ticket = await this.siteApi.getByReference({
        provider: 'discord',
        external_type: 'thread',
        external_id: threadId,
        user_id: viewerUserId ?? this.config.site.actorUserId,
      });
      this.rememberMapping(ticket, threadId);
      return ticket.public_number;
    } catch (error) {
      if (
        error instanceof TicketApiError &&
        (error.code === 'reference_not_found' ||
          error.code === 'reference_ambiguous' ||
          error.code === 'forbidden_view')
      ) {
        this.logger.warn(
          { threadId, code: error.code },
          'Cannot resolve ticket by Discord thread reference'
        );
        return undefined;
      }
      throw error;
    }
  }

  private rememberMapping(ticket: Ticket, threadId: string): void {
    if (this.mappingStore.hasThread(threadId)) {
      return;
    }
    const isConfidential = isTicketConfidential(ticket);
    this.mappingStore.set({
      ticketNumber: ticket.public_number,
      threadId,
      channelId: isConfidential
        ? this.config.discord.confidentialForumChannelId
        : this.config.discord.forumChannelId,
      isConfidential,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async handleDiscordMessage(
    threadId: string,
    messageId: string,
    authorId: string,
    content: string
  ): Promise<{ notice?: string }> {
    const ticketNumber = await this.resolveTicketNumber(threadId);
    if (!ticketNumber) {
      return {};
    }

    if (this.dedupeGuard.isProcessed(messageId)) {
      return {};
    }

    const parsed = parseStaffThreadMessage(content);
    if (isEmptyStaffBody(parsed.body)) {
      return {};
    }

    const action: StaffAction = parsed.isInternal ? 'internal_note' : 'reply';
    const resolved = await resolveStaffFromDiscord(
      this.siteApi,
      authorId,
      action,
      this.config.site.url
    );

    if (!resolved.ok) {
      await this.threadManager.postSystemNotice(threadId, resolved.reason);
      return { notice: resolved.reason };
    }

    const request: AddMessageRequest = {
      user_id: resolved.user.user_id,
      body: parsed.body,
      is_internal: parsed.isInternal,
      external_message_id: messageId,
      source: TicketSource.Discord,
    };

    try {
      const response = await this.siteApi.addMessage(ticketNumber, request);
      this.dedupeGuard.markProcessed(messageId);
      this.mappingStore.updateLastSyncedMessage(ticketNumber, response.id);

      this.logger.info(
        {
          ticket: ticketNumber,
          discordMessageId: messageId,
          siteMessageId: response.id,
          duplicate: response.duplicate,
          isInternal: parsed.isInternal,
        },
        response.duplicate
          ? 'Replay of Discord message ignored by site'
          : 'Synced Discord message to site'
      );
      return {};
    } catch (error) {
      if (error instanceof TicketApiError) {
        const notice = messageForForbidden(error.code);
        await this.threadManager.postSystemNotice(threadId, notice);
        return { notice };
      }
      this.logger.error(
        { error, ticket: ticketNumber, messageId },
        'Failed to sync Discord message to site'
      );
      throw error;
    }
  }

  async handleTicketButton(
    threadId: string,
    discordUserId: string,
    buttonId: string
  ): Promise<{ notice?: string }> {
    const action = actionFromTicketButton(buttonId);
    if (action.kind === 'unknown') {
      return { notice: 'Неизвестная кнопка.' };
    }

    if (action.kind === 'status') {
      return this.handleStatusButton(threadId, discordUserId, action.status);
    }

    const staffAction: StaffAction =
      action.kind === 'claim' ? 'assign' : 'change_priority';
    const resolved = await resolveStaffFromDiscord(
      this.siteApi,
      discordUserId,
      staffAction,
      this.config.site.url
    );

    if (!resolved.ok) {
      await this.threadManager.postSystemNotice(threadId, resolved.reason);
      return { notice: resolved.reason };
    }

    const ticketNumber = await this.resolveTicketNumber(
      threadId,
      resolved.user.user_id
    );
    if (!ticketNumber) {
      const notice = 'Тикет для этого треда не найден на сайте.';
      await this.threadManager.postSystemNotice(threadId, notice);
      return { notice };
    }

    try {
      const ticket =
        action.kind === 'claim'
          ? await this.siteApi.claimTicket(ticketNumber, {
              user_id: resolved.user.user_id,
              source: TicketSource.Discord,
            })
          : await this.siteApi.setPriority(ticketNumber, {
              user_id: resolved.user.user_id,
              priority: action.priority,
              source: TicketSource.Discord,
            });

      await this.updateThreadFromTicket(ticket);

      const notice =
        action.kind === 'claim'
          ? `Тикет ${ticketNumber} взят в работу.`
          : `Приоритет ${ticketNumber}: ${ticket.priority}.`;

      this.logger.info(
        {
          ticket: ticketNumber,
          buttonId,
          userId: resolved.user.user_id,
        },
        'Applied ticket card button'
      );
      return { notice };
    } catch (error) {
      if (error instanceof TicketApiError) {
        const notice = messageForForbidden(error.code);
        await this.threadManager.postSystemNotice(threadId, notice);
        return { notice };
      }
      throw error;
    }
  }

  async handleStatusButton(
    threadId: string,
    discordUserId: string,
    newStatus: TicketStatus
  ): Promise<{ notice?: string }> {
    const staffAction: StaffAction =
      newStatus === TicketStatus.Closed ? 'close' : 'change_status';
    const resolved = await resolveStaffFromDiscord(
      this.siteApi,
      discordUserId,
      staffAction,
      this.config.site.url
    );

    if (!resolved.ok) {
      await this.threadManager.postSystemNotice(threadId, resolved.reason);
      return { notice: resolved.reason };
    }

    const ticketNumber = await this.resolveTicketNumber(
      threadId,
      resolved.user.user_id
    );
    if (!ticketNumber) {
      const notice = 'Тикет для этого треда не найден на сайте.';
      await this.threadManager.postSystemNotice(threadId, notice);
      return { notice };
    }

    try {
      const ticket = await this.siteApi.changeStatus(ticketNumber, {
        status: newStatus,
        user_id: resolved.user.user_id,
        source: TicketSource.Discord,
      });
      await this.updateThreadFromTicket(ticket);

      this.logger.info(
        { ticket: ticketNumber, newStatus, userId: resolved.user.user_id },
        'Changed ticket status from Discord'
      );
      return { notice: `Статус ${ticketNumber}: ${ticket.status}.` };
    } catch (error) {
      if (error instanceof TicketApiError) {
        const notice = messageForForbidden(error.code);
        await this.threadManager.postSystemNotice(threadId, notice);
        return { notice };
      }
      throw error;
    }
  }
}
