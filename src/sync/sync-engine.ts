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
} from './staff-resolver.js';

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
        '[DRY RUN] Sync engine would poll GET /events'
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
    } catch (error) {
      this.logger.error({ error }, 'Site → Discord sync failed');
    }
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

  async handleDiscordMessage(
    threadId: string,
    messageId: string,
    authorId: string,
    content: string
  ): Promise<{ notice?: string }> {
    const ticketNumber = this.mappingStore.getTicketByThread(threadId);
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

    const action = parsed.isInternal ? 'internal_note' : 'reply';
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

  async handleStatusButton(
    threadId: string,
    discordUserId: string,
    newStatus: TicketStatus
  ): Promise<{ notice?: string }> {
    const ticketNumber = this.mappingStore.getTicketByThread(threadId);
    if (!ticketNumber) {
      return {};
    }

    const action = newStatus === TicketStatus.Closed ? 'close' : 'change_status';
    const resolved = await resolveStaffFromDiscord(
      this.siteApi,
      discordUserId,
      action,
      this.config.site.url
    );

    if (!resolved.ok) {
      await this.threadManager.postSystemNotice(threadId, resolved.reason);
      return { notice: resolved.reason };
    }

    await this.siteApi.changeStatus(ticketNumber, {
      status: newStatus,
      user_id: resolved.user.user_id,
      source: TicketSource.Discord,
    });

    this.logger.info(
      { ticket: ticketNumber, newStatus, userId: resolved.user.user_id },
      'Changed ticket status from Discord'
    );
    return {};
  }
}
