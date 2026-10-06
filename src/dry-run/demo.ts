/**
 * Сценарий dry-run: логирует, что бот сделал бы без токенов и сети.
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import {
  TicketAuthorType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type Ticket,
  type TicketMessage,
} from '../types/api.js';
import {
  mapCreatedTicketToThreadDraft,
  mapSiteMessageToDiscordDraft,
  parseStaffThreadMessage,
} from '../discord/event-mapper.js';
import { routeTicketToForum } from '../routing/confidentiality.js';
import {
  shouldIgnoreIncomingDiscordMessage,
  shouldSkipSiteEventToAvoidLoop,
} from '../sync/loop-guard.js';
import { DedupeGuard } from '../sync/dedupe-guard.js';
import { StatsCollector } from '../stats/collector.js';

export function runDryRunDemo(config: Config, logger: Logger): void {
  logger.info(
    {
      guild: config.discord.guildId || '(not set)',
      publicForum: config.discord.forumChannelId || '(not set)',
      confidentialForum: config.discord.confidentialForumChannelId || '(not set)',
      siteUrl: config.site.url || '(not set)',
    },
    '[DRY RUN] Starting offline demonstration — no Discord/site connections'
  );

  const publicTicket: Ticket = {
    public_number: 'COINT-1001',
    status: TicketStatus.Open,
    priority: TicketPriority.Normal,
    source: TicketSource.Website,
    subject: 'Не заходит на сервер',
    category: 'technical',
    messages: [
      {
        id: 1,
        body: 'После обновления лаунчера не пускает на Survival.',
        is_internal: false,
        author_type: TicketAuthorType.User,
        source: TicketSource.Website,
        external_message_id: null,
      },
    ],
    references: [],
  };

  const confidentialTicket: Ticket = {
    ...publicTicket,
    public_number: 'COINT-1002',
    subject: 'Жалоба на модератора',
    category: 'staff_complaint',
  };

  const publicDraft = mapCreatedTicketToThreadDraft(publicTicket);
  const confidentialDraft = mapCreatedTicketToThreadDraft(confidentialTicket);

  logger.info(
    { title: publicDraft.title, channel: publicDraft.channel, tags: publicDraft.tags },
    '[DRY RUN] Would create public forum thread'
  );

  const confidentialRoute = routeTicketToForum(confidentialTicket.category, {
    publicForumChannelId: config.discord.forumChannelId || 'public-forum',
    confidentialForumChannelId:
      config.discord.confidentialForumChannelId || 'confidential-forum',
  });

  logger.info(
    {
      title: confidentialDraft.title,
      channel: confidentialDraft.channel,
      route: confidentialRoute,
    },
    '[DRY RUN] Would create confidential thread only in the restricted forum'
  );

  const staffReply: TicketMessage = {
    id: 2,
    body: 'Проверяем логи входа.',
    is_internal: false,
    author_type: TicketAuthorType.Staff,
    source: TicketSource.Website,
    external_message_id: null,
  };

  logger.info(
    mapSiteMessageToDiscordDraft('COINT-1001', 'technical', staffReply),
    '[DRY RUN] Would post staff reply from the site into the thread'
  );

  const echoFromDiscord: TicketMessage = {
    ...staffReply,
    id: 3,
    source: TicketSource.Discord,
    external_message_id: '123456789012345678',
  };

  const skipLoop = shouldSkipSiteEventToAvoidLoop({
    source: echoFromDiscord.source,
    externalMessageId: echoFromDiscord.external_message_id,
  });
  logger.info(
    { skipLoop, source: echoFromDiscord.source },
    '[DRY RUN] Would skip site→Discord echo of a Discord-sourced message'
  );

  const ignoreBot = shouldIgnoreIncomingDiscordMessage({
    id: 'bot-msg',
    content: 'mirror',
    author: { id: 'bot', bot: true },
  });
  const ignoreWebhook = shouldIgnoreIncomingDiscordMessage({
    id: 'hook-msg',
    content: 'webhook',
    author: { id: 'hook', bot: true, webhookId: 'wh-1' },
  });
  logger.info(
    { ignoreBot, ignoreWebhook },
    '[DRY RUN] Would ignore bot/webhook authors to prevent loops'
  );

  const note = parseStaffThreadMessage('!note Проверил логи на бэке');
  logger.info(
    { note, wouldPost: { source: 'discord', is_internal: note.isInternal } },
    '[DRY RUN] Would send !note as an internal site note'
  );

  const dedupe = new DedupeGuard(logger, 60);
  dedupe.markProcessed('123456789012345678');
  logger.info(
    { alreadyProcessed: dedupe.isProcessed('123456789012345678') },
    '[DRY RUN] Dedupe guard would reject a replay of the same Discord message id'
  );

  const stats = new StatsCollector(config, logger);
  const createdAt = new Date('2026-10-01T10:00:00Z');
  stats.recordTicketMetrics({
    ticketNumber: 'COINT-1001',
    category: 'technical',
    priority: TicketPriority.Normal,
    createdAt,
    staffRepliesCount: 1,
    userRepliesCount: 1,
  });
  stats.recordFirstResponse('COINT-1001', new Date('2026-10-01T10:20:00Z'));
  stats.recordResolution('COINT-1001', new Date('2026-10-01T11:00:00Z'));
  const summary = stats.calculateStats(
    new Date('2026-10-01T00:00:00Z'),
    new Date('2026-10-08T00:00:00Z')
  );
  logger.info(
    {
      totalTickets: summary.totalTickets,
      avgFirstResponseTimeMinutes: summary.avgFirstResponseTimeMinutes,
      slaNormal: summary.slaCompliance.normal,
    },
    '[DRY RUN] Stats module would compute first-response / SLA from ticket metrics'
  );

  logger.info(
    {
      afterId: 0,
      endpoint: 'GET /api/internal/tickets/events?after_id=&limit=',
    },
    '[DRY RUN] Would poll the site event feed and persist the cursor'
  );

  logger.info(
    {
      lookup: 'GET /api/internal/users/by-discord/{id}',
      unlinked: 'Привяжите Discord в профиле на сайте',
    },
    '[DRY RUN] Would resolve staff via Discord link and reject unlinked users'
  );
}
