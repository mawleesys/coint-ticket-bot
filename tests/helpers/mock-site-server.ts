/**
 * Mock HTTP-сервер Internal Ticket API по спецификации site-internal-api.md.
 */

import http from 'node:http';
import { URL } from 'node:url';
import {
  TicketAuthorType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type Ticket,
  type TicketMessage,
} from '../../src/types/api.js';

export const MOCK_API_TOKEN = 'test-internal-token';

interface StoredTicket extends Ticket {
  nextMessageId: number;
}

export interface MockSiteServer {
  url: string;
  close: () => Promise<void>;
  getTicket: (number: string) => StoredTicket | undefined;
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

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function wantsJson(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('application/json');
}

function authorize(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${MOCK_API_TOKEN}`;
}

export async function startMockSiteServer(): Promise<MockSiteServer> {
  const tickets = new Map<string, StoredTicket>();
  const references = new Map<string, { ticket: string; id: number }>();
  let nextRefId = 1;
  let nextPublic = 1200;

  tickets.set('COINT-1207', {
    public_number: 'COINT-1207',
    status: TicketStatus.WaitingForStaff,
    priority: TicketPriority.Normal,
    source: TicketSource.Website,
    subject: 'Не заходит на сервер',
    category: 'technical',
    messages: [
      {
        id: 901,
        body: 'Текст сообщения',
        is_internal: false,
        author_type: TicketAuthorType.User,
        source: TicketSource.Website,
        external_message_id: null,
      },
    ],
    references: [],
    nextMessageId: 902,
  });

  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      const host = req.headers.host ?? '127.0.0.1';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;

      if (!path.startsWith('/api/internal/tickets')) {
        send(res, 404, { message: 'Not Found' });
        return;
      }

      if (!authorize(req)) {
        send(res, 401, { message: 'Unauthenticated.' });
        return;
      }

      const relative = path.replace('/api/internal/tickets', '') || '/';

      if (req.method === 'POST' && relative === '/') {
        if (!wantsJson(req)) {
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        const raw = await parseBody(req);
        const body = JSON.parse(raw) as {
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

        const publicNumber = `COINT-${nextPublic++}`;
        const ticket: StoredTicket = {
          public_number: publicNumber,
          status: TicketStatus.Open,
          priority: TicketPriority.Normal,
          source: (body.source as TicketSource) ?? TicketSource.Website,
          subject: body.subject,
          category: body.category_key,
          messages: [
            {
              id: 1,
              body: body.body,
              is_internal: false,
              author_type: TicketAuthorType.User,
              source: (body.source as TicketSource) ?? TicketSource.Website,
              external_message_id: null,
            },
          ],
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
        const raw = await parseBody(req);
        const body = JSON.parse(raw) as {
          user_id?: number;
          body?: string;
          is_internal?: boolean;
          external_message_id?: string;
          source?: string;
        };
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
          author_type: TicketAuthorType.Staff,
          source: (body.source as TicketSource) ?? TicketSource.Discord,
          external_message_id: body.external_message_id ?? null,
        };
        ticket.messages.push(message);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: message.id, is_internal: message.is_internal }));
        return;
      }

      const statusMatch = /^\/([^/]+)\/status$/.exec(relative);
      if (req.method === 'POST' && statusMatch) {
        const ticket = resolveTicket(tickets, decodeURIComponent(statusMatch[1]));
        if (!ticket) {
          send(res, 404, { message: 'Ticket not found' });
          return;
        }
        const raw = await parseBody(req);
        const body = JSON.parse(raw) as { status?: TicketStatus };
        if (!body.status) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { status: ['Поле обязательно.'] },
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
        const raw = await parseBody(req);
        const body = JSON.parse(raw) as {
          provider?: string;
          external_type?: string;
          external_id?: string;
        };
        if (!body.provider || !body.external_type || !body.external_id) {
          send(res, 422, { message: 'The given data was invalid.' });
          return;
        }
        const key = `${body.provider}:${body.external_type}:${body.external_id}`;
        const existing = references.get(key);
        const id = existing?.id ?? nextRefId++;
        references.set(key, { ticket: ticket.public_number, id });
        ticket.references = ticket.references.filter(
          (item) =>
            !(
              item.provider === body.provider &&
              item.external_type === body.external_type &&
              item.external_id === body.external_id
            )
        );
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
  if (legacy !== key && tickets.has(legacy)) {
    return tickets.get(legacy);
  }
  return undefined;
}

function toPayload(ticket: StoredTicket, includeInternal: boolean): Ticket {
  return {
    public_number: ticket.public_number,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    subject: ticket.subject,
    category: ticket.category,
    messages: ticket.messages.filter((message) => includeInternal || !message.is_internal),
    references: ticket.references,
  };
}
