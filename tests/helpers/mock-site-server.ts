/**
 * Mock HTTP-сервер Internal Ticket API по спецификации 2026-10-06.
 */

import http from 'node:http';
import { URL } from 'node:url';
import {
  TicketAuthorType,
  TicketEventType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type OutboxEvent,
  type Ticket,
  type TicketMessage,
  type UserLookupResponse,
} from '../../src/types/api.js';

export const MOCK_API_TOKEN = 'test-internal-token';

export const DISCORD_STAFF_ID = '111111111111111111';
export const DISCORD_UNLINKED_ID = '222222222222222222';
export const DISCORD_CONFLICT_ID = '333333333333333333';
export const DISCORD_BANNED_ID = '444444444444444444';
export const DISCORD_PLAYER_ID = '555555555555555555';

interface StoredTicket extends Ticket {
  nextMessageId: number;
}

export interface MockSiteServer {
  url: string;
  close: () => Promise<void>;
  getTicket: (number: string) => StoredTicket | undefined;
  pushEvent: (event: Omit<OutboxEvent, 'id'> & { id?: number }) => OutboxEvent;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function wantsJson(req: http.IncomingMessage): boolean {
  return (req.headers.accept ?? '').includes('application/json');
}

function authorize(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${MOCK_API_TOKEN}`;
}

function staffUser(overrides: Partial<UserLookupResponse> = {}): UserLookupResponse {
  return {
    user_id: 45,
    name: 'Helper',
    discord_name: 'helper',
    role: 'Хелпер',
    role_id: 13,
    role_power: 5,
    is_banned: false,
    permissions: {
      can_view_tickets: true,
      can_view_all_tickets: true,
      can_reply: true,
      can_internal_notes: true,
      can_view_sensitive: false,
      can_change_status: true,
      can_change_priority: true,
      can_assign: true,
      can_close: true,
      can_create_tickets: true,
      can_reply_own: true,
      is_admin: false,
    },
    ...overrides,
  };
}

export async function startMockSiteServer(): Promise<MockSiteServer> {
  const tickets = new Map<string, StoredTicket>();
  const references = new Map<string, { ticket: string; id: number }>();
  const messagesByExternal = new Map<string, { ticket: string; message: TicketMessage }>();
  const events: OutboxEvent[] = [];
  let nextEventId = 1;
  let nextRefId = 1;
  let nextPublic = 1200;
  let nextTicketId = 208;

  const seed: StoredTicket = {
    id: 207,
    public_number: 'COINT-1207',
    status: TicketStatus.WaitingForStaff,
    priority: TicketPriority.Normal,
    source: TicketSource.Website,
    subject: 'Не заходит на сервер',
    category: 'technical',
    category_name: 'Техническая проблема',
    is_sensitive: false,
    team: 'technical',
    owner_user_id: 123,
    assignee_user_id: null,
    created_at: '2026-10-06T10:00:00+05:00',
    updated_at: '2026-10-06T10:05:00+05:00',
    messages: [
      {
        id: 901,
        body: 'Текст сообщения',
        is_internal: false,
        author_type: TicketAuthorType.User,
        author_user_id: 123,
        source: TicketSource.Website,
        external_message_id: null,
        created_at: '2026-10-06T10:00:00+05:00',
      },
    ],
    attachments: [
      {
        id: 55,
        message_id: 901,
        original_name: 'latest.log',
        mime_type: 'text/plain',
        size: 20480,
        created_at: '2026-10-06T10:00:00+05:00',
      },
    ],
    references: [
      {
        provider: 'discord',
        external_type: 'thread',
        external_id: 'thread-1207',
      },
    ],
    sla_due_at: '2026-10-07T10:00:00+05:00',
    is_overdue: false,
    last_activity_at: '2026-10-06T10:05:00+05:00',
    first_response_at: null,
    nextMessageId: 902,
  };
  tickets.set(seed.public_number, seed);
  references.set('discord:thread:thread-1207', {
    ticket: seed.public_number,
    id: nextRefId++,
  });
  references.set('discord:message:thread-1207', {
    ticket: 'COINT-1208',
    id: nextRefId++,
  });

  const sensitive: StoredTicket = {
    id: 208,
    public_number: 'COINT-1208',
    status: TicketStatus.Open,
    priority: TicketPriority.High,
    source: TicketSource.Website,
    subject: 'Жалоба на модератора',
    category: 'staff_complaint',
    category_name: 'Жалоба на администрацию',
    is_sensitive: true,
    team: 'senior_admins',
    owner_user_id: 50,
    assignee_user_id: null,
    created_at: '2026-10-06T11:00:00+05:00',
    updated_at: '2026-10-06T11:00:00+05:00',
    sla_due_at: '2026-10-06T15:00:00+05:00',
    is_overdue: false,
    last_activity_at: '2026-10-06T11:00:00+05:00',
    messages: [
      {
        id: 1,
        body: 'Скрытый текст',
        is_internal: false,
        author_type: TicketAuthorType.User,
        author_user_id: 50,
        source: TicketSource.Website,
        external_message_id: null,
        created_at: '2026-10-06T11:00:00+05:00',
      },
      {
        id: 2,
        body: 'Внутренняя заметка',
        is_internal: true,
        author_type: TicketAuthorType.Staff,
        author_user_id: 45,
        source: TicketSource.Website,
        external_message_id: null,
        created_at: '2026-10-06T11:05:00+05:00',
      },
    ],
    attachments: [
      {
        id: 56,
        message_id: 2,
        original_name: 'note.txt',
        mime_type: 'text/plain',
        size: 12,
        created_at: '2026-10-06T11:05:00+05:00',
      },
    ],
    references: [
      {
        provider: 'discord',
        external_type: 'message',
        external_id: 'thread-1207',
      },
    ],
    nextMessageId: 3,
  };
  tickets.set(sensitive.public_number, sensitive);
  nextTicketId = 209;

  const pushEvent = (
    event: Omit<OutboxEvent, 'id'> & { id?: number }
  ): OutboxEvent => {
    const full: OutboxEvent = {
      id: event.id ?? nextEventId++,
      ...event,
    };
    if (full.id >= nextEventId) {
      nextEventId = full.id + 1;
    }
    events.push(full);
    return full;
  };

  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      const host = req.headers.host ?? '127.0.0.1';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;

      if (!authorize(req)) {
        send(res, 401, { message: 'Unauthenticated.' });
        return;
      }

      if (path.startsWith('/api/internal/users/by-discord/')) {
        const discordId = path.split('/').pop() ?? '';
        if (!/^\d{5,25}$/.test(discordId)) {
          send(res, 422, { message: 'Invalid Discord id.', code: 'invalid_discord_id' });
          return;
        }
        if (discordId === DISCORD_UNLINKED_ID) {
          send(res, 404, { message: 'Not linked.', code: 'discord_not_linked' });
          return;
        }
        if (discordId === DISCORD_CONFLICT_ID) {
          send(res, 409, {
            message: 'Linked to several accounts.',
            code: 'discord_link_conflict',
            user_ids: [10, 11],
          });
          return;
        }
        if (discordId === DISCORD_BANNED_ID) {
          send(res, 200, staffUser({ user_id: 88, is_banned: true, name: 'Banned' }));
          return;
        }
        if (discordId === DISCORD_PLAYER_ID) {
          send(
            res,
            200,
            staffUser({
              user_id: 9,
              name: 'Player',
              role: 'Игрок',
              role_power: 1,
              permissions: {
                ...staffUser().permissions,
                can_reply: false,
                can_internal_notes: false,
                can_change_status: false,
                can_close: false,
                can_view_all_tickets: false,
              },
            })
          );
          return;
        }
        send(res, 200, staffUser());
        return;
      }

      if (!path.startsWith('/api/internal/tickets')) {
        send(res, 404, { message: 'Not Found' });
        return;
      }

      const relative = path.replace('/api/internal/tickets', '') || '/';

      if (req.method === 'GET' && relative === '/events') {
        const afterId = Number(url.searchParams.get('after_id') ?? '0');
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);
        const slice = events.filter((event) => event.id > afterId).slice(0, limit);
        const last = slice.at(-1)?.id ?? afterId;
        send(res, 200, {
          data: slice,
          next_after_id: last,
          has_more: events.some((event) => event.id > last),
        });
        return;
      }

      if (req.method === 'GET' && relative === '/by-reference') {
        const provider = url.searchParams.get('provider') ?? '';
        const externalId = url.searchParams.get('external_id') ?? '';
        const externalType = url.searchParams.get('external_type');
        const viewer = url.searchParams.get('user_id');
        if (!provider || !externalId) {
          send(res, 422, { message: 'The given data was invalid.' });
          return;
        }
        if (viewer === '8') {
          send(res, 403, { message: 'Cannot view.', code: 'forbidden_view' });
          return;
        }
        const matches = [...references.entries()].filter(([key, value]) => {
          const [prov, type, id] = key.split(':');
          if (prov !== provider || id !== externalId) {
            return false;
          }
          if (externalType && type !== externalType) {
            return false;
          }
          return Boolean(tickets.get(value.ticket));
        });
        const uniqueTickets = [...new Set(matches.map(([, value]) => value.ticket))];
        if (uniqueTickets.length === 0) {
          send(res, 404, { message: 'Not found.', code: 'reference_not_found' });
          return;
        }
        if (uniqueTickets.length > 1) {
          send(res, 409, {
            message: 'Ambiguous reference.',
            code: 'reference_ambiguous',
            ticket_numbers: uniqueTickets,
          });
          return;
        }
        const ticket = tickets.get(uniqueTickets[0]);
        if (!ticket) {
          send(res, 404, { message: 'Not found.', code: 'reference_not_found' });
          return;
        }
        const includeInternal = ['1', 'true'].includes(
          url.searchParams.get('include_internal') ?? ''
        );
        send(res, 200, toPayload(ticket, includeInternal));
        return;
      }

      if (req.method === 'GET' && relative === '/stats') {
        const viewer = url.searchParams.get('user_id');
        if (viewer === '8') {
          send(res, 403, { message: 'No stats.', code: 'forbidden_stats' });
          return;
        }
        send(res, 200, mockStatsFixture());
        return;
      }

      if (req.method === 'GET' && relative === '/') {
        const userId = url.searchParams.get('user_id');
        if (!userId) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { user_id: ['Поле обязательно.'] },
          });
          return;
        }
        if (userId === '8') {
          send(res, 403, { message: 'Cannot view.', code: 'forbidden_view' });
          return;
        }
        const queue = url.searchParams.get('queue') ?? 'all';
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const page = Math.max(Number(url.searchParams.get('page') ?? '1'), 1);
        const perPage = Math.min(
          Math.max(Number(url.searchParams.get('per_page') ?? '30'), 1),
          100
        );
        const filtered = [...tickets.values()].filter((ticket) => {
          if (q && !ticket.public_number.toLowerCase().includes(q) && !ticket.subject.toLowerCase().includes(q)) {
            return false;
          }
          return matchesQueue(ticket, queue, Number(userId));
        });
        const total = filtered.length;
        const lastPage = Math.max(Math.ceil(total / perPage), 1);
        const slice = filtered.slice((page - 1) * perPage, page * perPage);
        send(res, 200, {
          data: slice.map((ticket) => toSummary(ticket)),
          meta: { page, per_page: perPage, total, last_page: lastPage },
        });
        return;
      }

      if (req.method === 'GET' && relative === '/categories') {
        send(res, 200, {
          data: [
            {
              key: 'technical',
              name: 'Техническая проблема',
              description: '',
              is_active: true,
              is_sensitive: false,
              requires_server: true,
              default_priority: 'normal',
              team: 'technical',
              form_schema: { fields: [] },
            },
            {
              key: 'staff_complaint',
              name: 'Жалоба на администрацию',
              is_active: true,
              is_sensitive: true,
              requires_server: false,
              default_priority: 'high',
              team: 'senior_admins',
              form_schema: { fields: [] },
            },
          ],
        });
        return;
      }

      if (req.method === 'POST' && relative === '/') {
        if (!wantsJson(req)) {
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          user_id?: number;
          category_key?: string;
          subject?: string;
          body?: string;
          source?: string;
        };
        if (!body.user_id || !body.category_key || !body.subject || !body.body) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { subject: ['Поле обязательно.'] },
          });
          return;
        }
        if (body.source && !['website', 'discord', 'system'].includes(body.source)) {
          send(res, 422, { message: 'Unsupported ticket source.' });
          return;
        }
        if (body.category_key === 'unknown_cat') {
          send(res, 422, { message: 'Unknown category.' });
          return;
        }
        if (body.user_id === 77) {
          send(res, 403, { message: 'Banned.', code: 'user_banned' });
          return;
        }

        const publicNumber = `COINT-${nextPublic++}`;
        const ticket: StoredTicket = {
          id: nextTicketId++,
          public_number: publicNumber,
          status: TicketStatus.Open,
          priority: TicketPriority.Normal,
          source: (body.source as TicketSource) ?? TicketSource.Website,
          subject: body.subject,
          category: body.category_key,
          is_sensitive: body.category_key === 'staff_complaint',
          owner_user_id: body.user_id,
          messages: [
            {
              id: 1,
              body: body.body,
              is_internal: false,
              author_type: TicketAuthorType.User,
              author_user_id: body.user_id,
              source: (body.source as TicketSource) ?? TicketSource.Website,
              external_message_id: null,
            },
          ],
          attachments: [],
          references: [],
          nextMessageId: 2,
        };
        tickets.set(publicNumber, ticket);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(toPayload(ticket, false)));
        return;
      }

      const show = /^\/([^/]+)$/.exec(relative);
      if (req.method === 'GET' && show) {
        const ticket = resolveTicket(tickets, decodeURIComponent(show[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const includeInternal = ['1', 'true'].includes(
          url.searchParams.get('include_internal') ?? ''
        );
        send(res, 200, toPayload(ticket, includeInternal));
        return;
      }

      const messages = /^\/([^/]+)\/messages$/.exec(relative);
      if (req.method === 'POST' && messages) {
        if (!wantsJson(req)) {
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        const ticket = resolveTicket(tickets, decodeURIComponent(messages[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          user_id?: number;
          body?: string;
          is_internal?: boolean;
          external_message_id?: string;
          source?: string;
        };
        const source = (body.source as TicketSource) ?? TicketSource.Discord;

        if (body.external_message_id) {
          const key = `${source}:${body.external_message_id}`;
          const existing = messagesByExternal.get(key);
          if (existing) {
            if (existing.ticket !== ticket.public_number) {
              send(res, 409, {
                code: 'external_message_conflict',
                ticket_number: existing.ticket,
                id: existing.message.id,
                message: 'Message already on another ticket.',
              });
              return;
            }
            send(res, 200, {
              id: existing.message.id,
              is_internal: existing.message.is_internal,
              author_type: existing.message.author_type,
              duplicate: true,
            });
            return;
          }
        }

        if (body.user_id === 77) {
          send(res, 403, { message: 'Banned.', code: 'user_banned' });
          return;
        }
        if (body.user_id === 9 && !body.is_internal) {
          send(res, 403, { message: 'No reply permission.', code: 'forbidden_reply' });
          return;
        }
        if (!body.user_id || !body.body?.trim()) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { body: ['Поле обязательно.'] },
          });
          return;
        }
        if (ticket.status === TicketStatus.Closed) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { body: ['Тикет закрыт.'] },
          });
          return;
        }

        const message: TicketMessage = {
          id: ticket.nextMessageId++,
          body: body.body.trim(),
          is_internal: Boolean(body.is_internal),
          author_type:
            body.user_id === ticket.owner_user_id
              ? TicketAuthorType.User
              : TicketAuthorType.Staff,
          author_user_id: body.user_id,
          source,
          external_message_id: body.external_message_id ?? null,
        };
        ticket.messages.push(message);
        if (body.external_message_id) {
          messagesByExternal.set(`${source}:${body.external_message_id}`, {
            ticket: ticket.public_number,
            message,
          });
        }
        pushEvent({
          ticket_id: ticket.id ?? 0,
          ticket_number: ticket.public_number,
          category: ticket.category,
          is_sensitive: Boolean(ticket.is_sensitive),
          event_type: TicketEventType.MessageCreated,
          source,
          actor_user_id: body.user_id,
          message_id: message.id,
          payload: {
            author_type: message.author_type,
            is_internal: message.is_internal,
          },
          created_at: new Date().toISOString(),
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: message.id,
            is_internal: message.is_internal,
            author_type: message.author_type,
            duplicate: false,
          })
        );
        return;
      }

      const statusMatch = /^\/([^/]+)\/status$/.exec(relative);
      if (req.method === 'POST' && statusMatch) {
        const ticket = resolveTicket(tickets, decodeURIComponent(statusMatch[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          status?: TicketStatus;
          user_id?: number;
          source?: string;
        };
        if (!body.status) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { status: ['Поле обязательно.'] },
          });
          return;
        }
        if (body.source !== 'system' && !body.user_id) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { user_id: ['Поле обязательно.'] },
          });
          return;
        }
        ticket.status = body.status;
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const refs = /^\/([^/]+)\/references$/.exec(relative);
      if (req.method === 'POST' && refs) {
        const ticket = resolveTicket(tickets, decodeURIComponent(refs[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          provider?: string;
          external_type?: string;
          external_id?: string;
          move?: boolean;
        };
        if (!body.provider || !body.external_type || !body.external_id) {
          send(res, 422, { message: 'The given data was invalid.' });
          return;
        }
        const key = `${body.provider}:${body.external_type}:${body.external_id}`;
        const existing = references.get(key);
        if (existing && existing.ticket !== ticket.public_number) {
          if (!body.move) {
            send(res, 409, {
              code: 'reference_conflict',
              ticket_number: existing.ticket,
              message: 'Reference belongs to another ticket.',
            });
            return;
          }
          references.set(key, { ticket: ticket.public_number, id: existing.id });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: existing.id,
              provider: body.provider,
              external_type: body.external_type,
              external_id: body.external_id,
            })
          );
          return;
        }
        if (existing && existing.ticket === ticket.public_number) {
          send(res, 200, {
            id: existing.id,
            provider: body.provider,
            external_type: body.external_type,
            external_id: body.external_id,
          });
          return;
        }
        const id = nextRefId++;
        references.set(key, { ticket: ticket.public_number, id });
        ticket.references.push({
          provider: body.provider,
          external_type: body.external_type,
          external_id: body.external_id,
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id,
            provider: body.provider,
            external_type: body.external_type,
            external_id: body.external_id,
          })
        );
        return;
      }

      const claim = /^\/([^/]+)\/claim$/.exec(relative);
      if (req.method === 'POST' && claim) {
        const ticket = resolveTicket(tickets, decodeURIComponent(claim[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as { user_id?: number };
        if (!body.user_id) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { user_id: ['Поле обязательно.'] },
          });
          return;
        }
        if (body.user_id === 9) {
          send(res, 403, { message: 'No assign.', code: 'forbidden_assign' });
          return;
        }
        ticket.assignee_user_id = body.user_id;
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const assign = /^\/([^/]+)\/assign$/.exec(relative);
      if (req.method === 'POST' && assign) {
        const ticket = resolveTicket(tickets, decodeURIComponent(assign[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          user_id?: number;
          assignee_user_id?: number | null;
          team?: string | null;
        };
        if (body.user_id === 9) {
          send(res, 403, { message: 'No assign.', code: 'forbidden_assign' });
          return;
        }
        if (body.assignee_user_id === undefined && body.team === undefined) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { assignee_user_id: ['Укажите исполнителя или команду.'] },
          });
          return;
        }
        if (body.assignee_user_id !== undefined) {
          ticket.assignee_user_id = body.assignee_user_id;
        }
        if (body.team !== undefined) {
          ticket.team = body.team;
        }
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const unassign = /^\/([^/]+)\/unassign$/.exec(relative);
      if (req.method === 'POST' && unassign) {
        const ticket = resolveTicket(tickets, decodeURIComponent(unassign[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as { user_id?: number };
        if (body.user_id === 9) {
          send(res, 403, { message: 'No assign.', code: 'forbidden_assign' });
          return;
        }
        ticket.assignee_user_id = null;
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const priority = /^\/([^/]+)\/priority$/.exec(relative);
      if (req.method === 'POST' && priority) {
        const ticket = resolveTicket(tickets, decodeURIComponent(priority[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          user_id?: number;
          priority?: TicketPriority;
        };
        if (body.user_id === 9) {
          send(res, 403, { message: 'No priority.', code: 'forbidden_priority' });
          return;
        }
        if (!body.priority) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { priority: ['Поле обязательно.'] },
          });
          return;
        }
        ticket.priority = body.priority;
        ticket.sla_due_at = slaDueForPriority(body.priority, ticket.created_at);
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const category = /^\/([^/]+)\/category$/.exec(relative);
      if (req.method === 'POST' && category) {
        const ticket = resolveTicket(tickets, decodeURIComponent(category[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const body = JSON.parse(await parseBody(req)) as {
          user_id?: number;
          category_key?: string;
          server_id?: number;
        };
        if (body.user_id === 9) {
          send(res, 403, { message: 'No category.', code: 'forbidden_category' });
          return;
        }
        if (!body.category_key) {
          send(res, 422, { message: 'Unknown category.' });
          return;
        }
        ticket.category = body.category_key;
        ticket.is_sensitive = body.category_key === 'staff_complaint';
        if (body.server_id !== undefined) {
          ticket.server_id = body.server_id;
        }
        send(res, 200, toPayload(ticket, false));
        return;
      }

      const scopedAttachment = /^\/([^/]+)\/attachments\/([^/]+)$/.exec(relative);
      if (req.method === 'GET' && scopedAttachment) {
        const ticket = resolveTicket(
          tickets,
          decodeURIComponent(scopedAttachment[1])
        );
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const attachmentId = Number(scopedAttachment[2]);
        const attachment = (ticket.attachments ?? []).find(
          (item) => item.id === attachmentId
        );
        if (!attachment) {
          send(res, 404, { message: 'Attachment not found' });
          return;
        }
        const userId = url.searchParams.get('user_id');
        const parent = ticket.messages.find(
          (message) => message.id === attachment.message_id
        );
        if (!userId && (ticket.is_sensitive || parent?.is_internal)) {
          send(res, 403, { message: 'user_id required.', code: 'user_required' });
          return;
        }
        if (userId === '9' && (ticket.is_sensitive || parent?.is_internal)) {
          send(res, 403, {
            message: 'Cannot download.',
            code: 'forbidden_attachment_download',
          });
          return;
        }
        res.writeHead(200, {
          'Content-Disposition': `attachment; filename=${attachment.original_name}`,
          'Content-Type': attachment.mime_type,
        });
        res.end('mock-file');
        return;
      }

      if (req.method === 'POST' && /\/attachments$/.test(relative)) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 55 }));
        return;
      }

      if (req.method === 'GET' && relative.startsWith('/attachments/')) {
        const userId = url.searchParams.get('user_id');
        const attachmentId = Number(relative.split('/').pop());
        if (attachmentId === 56 && !userId) {
          send(res, 403, { message: 'user_id required.', code: 'user_required' });
          return;
        }
        res.writeHead(200, {
          'Content-Disposition': 'attachment; filename=log.txt',
        });
        res.end('mock-file');
        return;
      }

      send(res, 404, { message: 'Not Found' });
    })().catch((error: unknown) => {
      send(res, 500, { message: error instanceof Error ? error.message : 'error' });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock site server');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    getTicket: (number) => tickets.get(number),
    pushEvent,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

function resolveTicket(
  tickets: Map<string, StoredTicket>,
  key: string
): StoredTicket | undefined {
  if (tickets.has(key)) {
    return tickets.get(key);
  }
  const legacy = key.replace(/^COI-/, 'COINT-');
  return legacy !== key ? tickets.get(legacy) : undefined;
}

function matchesQueue(
  ticket: StoredTicket,
  queue: string,
  userId: number
): boolean {
  const active = new Set([
    TicketStatus.Open,
    TicketStatus.InProgress,
    TicketStatus.WaitingForStaff,
    TicketStatus.WaitingForUser,
  ]);
  switch (queue) {
    case 'inbox':
      return active.has(ticket.status);
    case 'mine':
      return active.has(ticket.status) && ticket.assignee_user_id === userId;
    case 'unassigned':
      return active.has(ticket.status) && ticket.assignee_user_id == null;
    case 'waiting-user':
      return ticket.status === TicketStatus.WaitingForUser;
    case 'waiting-staff':
      return ticket.status === TicketStatus.WaitingForStaff;
    case 'overdue':
      return Boolean(ticket.is_overdue);
    case 'resolved':
      return (
        ticket.status === TicketStatus.Resolved ||
        ticket.status === TicketStatus.Closed
      );
    default:
      return true;
  }
}

function toSummary(ticket: StoredTicket) {
  return {
    id: ticket.id ?? 0,
    public_number: ticket.public_number,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    subject: ticket.subject,
    category: ticket.category,
    category_name: ticket.category_name,
    is_sensitive: ticket.is_sensitive,
    team: ticket.team,
    owner_user_id: ticket.owner_user_id,
    assignee_user_id: ticket.assignee_user_id,
    created_at: ticket.created_at,
    first_response_at: ticket.first_response_at ?? null,
    last_activity_at: ticket.last_activity_at,
    sla_due_at: ticket.sla_due_at ?? null,
    is_overdue: Boolean(ticket.is_overdue),
    references: ticket.references,
  };
}

function slaDueForPriority(priority: TicketPriority, createdAt?: string): string {
  const minutes: Record<TicketPriority, number> = {
    [TicketPriority.Low]: 2880,
    [TicketPriority.Normal]: 1440,
    [TicketPriority.High]: 240,
    [TicketPriority.Urgent]: 60,
  };
  const start = createdAt ? new Date(createdAt) : new Date();
  return new Date(start.getTime() + minutes[priority] * 60 * 1000).toISOString();
}

function mockStatsFixture() {
  return {
    period: { from: '2026-09-06', to: '2026-10-06' },
    tickets: {
      created: 120,
      by_status: { open: 10, resolved: 80, closed: 15 },
      by_priority: { normal: 100, high: 20 },
      by_source: { website: 90, discord: 30 },
      by_category: { technical: 40 },
      without_staff_reply: 5,
    },
    first_response: { count: 110, avg_seconds: 5400, median_seconds: 1800 },
    resolution: { count: 95, avg_seconds: 86400, median_seconds: 43200 },
    sla: {
      measured: 110,
      met: 100,
      breached: 10,
      pending: 3,
      met_rate: 0.9091,
      targets_minutes: { low: 2880, normal: 1440, high: 240, urgent: 60 },
    },
    by_channel: {
      replies: { website: 300, discord: 80 },
      first_responses: { website: 90, discord: 20 },
    },
    by_staff: [
      {
        user_id: 45,
        name: 'Helper',
        role: 'Хелпер',
        replies: 50,
        tickets_replied: 30,
        replies_by_source: { website: 40, discord: 10 },
        first_responses: 20,
        first_response: { count: 20, avg_seconds: 3600, median_seconds: 1500 },
        resolved: 15,
        closed: 3,
      },
    ],
  };
}

function toPayload(ticket: StoredTicket, includeInternal: boolean): Ticket {
  return {
    ...ticket,
    messages: ticket.messages.filter((message) => includeInternal || !message.is_internal),
    attachments: (ticket.attachments ?? []).filter((attachment) => {
      if (includeInternal) {
        return true;
      }
      const parent = ticket.messages.find((message) => message.id === attachment.message_id);
      return !parent?.is_internal;
    }),
  };
}
