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
    attachments: [],
    references: [],
    nextMessageId: 902,
  };
  tickets.set(seed.public_number, seed);

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

      if (req.method === 'POST' && /\/attachments$/.test(relative)) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 55 }));
        return;
      }

      if (req.method === 'GET' && relative.startsWith('/attachments/')) {
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
