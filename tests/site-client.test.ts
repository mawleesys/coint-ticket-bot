/**
 * Site API client против mock HTTP-сервера по спецификации 2026-10-06.
 */

import pino from 'pino';
import { SiteApiClient } from '../src/api/site-client.js';
import { createTestConfig } from '../src/config/index.js';
import {
  TicketApiError,
  TicketEventType,
  TicketSource,
  TicketStatus,
} from '../src/types/api.js';
import {
  DISCORD_CONFLICT_ID,
  DISCORD_STAFF_ID,
  DISCORD_UNLINKED_ID,
  MOCK_API_TOKEN,
  startMockSiteServer,
  type MockSiteServer,
} from './helpers/mock-site-server.js';

const logger = pino({ level: 'silent' });

describe('SiteApiClient (mock HTTP server)', () => {
  let server: MockSiteServer;
  let client: SiteApiClient;

  beforeAll(async () => {
    server = await startMockSiteServer();
    client = new SiteApiClient(
      createTestConfig({
        dryRun: false,
        site: {
          url: server.url,
          apiToken: MOCK_API_TOKEN,
          apiTimeout: 5000,
        },
      }),
      logger
    );
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a ticket and returns enriched payload fields', async () => {
    const created = await client.createTicket({
      user_id: 10,
      category_key: 'technical',
      subject: 'Тест API',
      body: 'Первое сообщение',
      source: TicketSource.Discord,
    });

    expect(created.public_number).toMatch(/^COINT-\d+$/);
    expect(created.status).toBe(TicketStatus.Open);
    expect(created.is_sensitive).toBe(false);
    expect(created.owner_user_id).toBe(10);
    expect(created.messages[0]?.body).toBe('Первое сообщение');
  });

  it('returns 422 JSON for unknown category', async () => {
    await expect(
      client.createTicket({
        user_id: 10,
        category_key: 'unknown_cat',
        subject: 'x',
        body: 'y',
      })
    ).rejects.toMatchObject({
      name: 'TicketApiError',
      statusCode: 422,
      message: 'Unknown category.',
    });
  });

  it('returns 403 user_banned on create', async () => {
    await expect(
      client.createTicket({
        user_id: 77,
        category_key: 'technical',
        subject: 'x',
        body: 'y',
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'user_banned' });
  });

  it('shows a ticket with owner/dates and hides internal notes by default', async () => {
    const ticket = await client.getTicket('COINT-1207');
    expect(ticket.public_number).toBe('COINT-1207');
    expect(ticket.owner_user_id).toBe(123);
    expect(ticket.is_sensitive).toBe(false);
    expect(ticket.messages.every((message) => !message.is_internal)).toBe(true);
  });

  it('accepts legacy COI- number rewrite', async () => {
    const ticket = await client.getTicket('COI-1207');
    expect(ticket.public_number).toBe('COINT-1207');
  });

  it('adds a Discord message with author_type and duplicate=false', async () => {
    const result = await client.addMessage('COINT-1207', {
      user_id: 45,
      body: 'Ответ из Discord',
      is_internal: false,
      external_message_id: '123456789012345678',
      source: TicketSource.Discord,
    });

    expect(result.id).toBeGreaterThan(0);
    expect(result.duplicate).toBe(false);
    expect(result.author_type).toBe('staff');
  });

  it('replays the same Discord message id as 200 duplicate:true', async () => {
    const replay = await client.addMessage('COINT-1207', {
      user_id: 45,
      body: 'Ответ из Discord',
      external_message_id: '123456789012345678',
      source: TicketSource.Discord,
    });
    expect(replay.duplicate).toBe(true);
  });

  it('returns 409 external_message_conflict when the id belongs to another ticket', async () => {
    const other = await client.createTicket({
      user_id: 10,
      category_key: 'technical',
      subject: 'Другой',
      body: 'body',
    });

    await expect(
      client.addMessage(other.public_number, {
        user_id: 45,
        body: 'reuse',
        external_message_id: '123456789012345678',
        source: TicketSource.Discord,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'external_message_conflict',
      ticketNumber: 'COINT-1207',
    });
  });

  it('adds an internal note', async () => {
    const result = await client.addMessage('COINT-1207', {
      user_id: 45,
      body: 'Внутренняя заметка',
      is_internal: true,
      source: TicketSource.Discord,
    });
    expect(result.is_internal).toBe(true);

    const withInternal = await client.getTicket('COINT-1207', true);
    expect(withInternal.messages.some((message) => message.is_internal)).toBe(true);
  });

  it('requires user_id on status unless source=system', async () => {
    await expect(
      client.changeStatus('COINT-1207', { status: TicketStatus.InProgress })
    ).rejects.toMatchObject({ statusCode: 422 });

    const system = await client.changeStatus('COINT-1207', {
      status: TicketStatus.InProgress,
      source: TicketSource.System,
    });
    expect(system.status).toBe(TicketStatus.InProgress);
  });

  it('changes status with user_id and stores a Discord thread reference', async () => {
    const updated = await client.changeStatus('COINT-1207', {
      status: TicketStatus.Resolved,
      user_id: 45,
      source: TicketSource.Discord,
    });
    expect(updated.status).toBe(TicketStatus.Resolved);

    const created = await client.addReference('COINT-1207', {
      provider: 'discord',
      external_type: 'thread',
      external_id: '987654321098765432',
    });
    expect(created.external_id).toBe('987654321098765432');

    const same = await client.addReference('COINT-1207', {
      provider: 'discord',
      external_type: 'thread',
      external_id: '987654321098765432',
    });
    expect(same.id).toBe(created.id);
  });

  it('returns 409 reference_conflict unless move:true', async () => {
    const other = await client.createTicket({
      user_id: 10,
      category_key: 'technical',
      subject: 'ref',
      body: 'body',
    });

    await expect(
      client.addReference(other.public_number, {
        provider: 'discord',
        external_type: 'thread',
        external_id: '987654321098765432',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'reference_conflict',
    });

    const moved = await client.addReference(other.public_number, {
      provider: 'discord',
      external_type: 'thread',
      external_id: '987654321098765432',
      move: true,
    });
    expect(moved.external_id).toBe('987654321098765432');
  });

  it('lists categories and polls the events feed', async () => {
    const categories = await client.getCategories();
    expect(categories.some((item) => item.key === 'staff_complaint' && item.is_sensitive)).toBe(
      true
    );

    server.pushEvent({
      ticket_id: 207,
      ticket_number: 'COINT-1207',
      category: 'technical',
      is_sensitive: false,
      event_type: TicketEventType.Created,
      source: TicketSource.Website,
      actor_user_id: 123,
      message_id: 901,
      payload: { source: 'website', category: 'technical', message_id: 901 },
      created_at: '2026-10-06T10:00:00+05:00',
    });

    const page = await client.getEvents(0, 50);
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.some((event) => event.event_type === TicketEventType.Created)).toBe(true);
    expect(typeof page.next_after_id).toBe('number');
    expect(page.data.every((event) => event.event_type !== 'internal_note_added')).toBe(
      true
    );
  });

  it('resolves Discord users and maps 404/409', async () => {
    const staff = await client.getUserByDiscordId(DISCORD_STAFF_ID);
    expect(staff.user_id).toBe(45);
    expect(staff.permissions.can_reply).toBe(true);

    await expect(client.getUserByDiscordId(DISCORD_UNLINKED_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'discord_not_linked',
    });
    await expect(client.getUserByDiscordId(DISCORD_CONFLICT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'discord_link_conflict',
    });
  });

  it('maps 401 / 404 to TicketApiError', async () => {
    const badAuth = new SiteApiClient(
      createTestConfig({
        dryRun: false,
        site: { url: server.url, apiToken: 'wrong', apiTimeout: 5000 },
      }),
      logger
    );

    await expect(badAuth.getTicket('COINT-1207')).rejects.toBeInstanceOf(TicketApiError);
    await expect(client.getTicket('COINT-0000')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('does not call the network in dry-run', async () => {
    const dry = new SiteApiClient(
      createTestConfig({
        dryRun: true,
        site: { url: 'http://127.0.0.1:1', apiToken: '', apiTimeout: 5000 },
      }),
      logger
    );

    const created = await dry.createTicket({
      user_id: 1,
      category_key: 'technical',
      subject: 'dry',
      body: 'dry',
    });
    expect(created.public_number).toBe('COINT-9999');
    const events = await dry.getEvents(0);
    expect(events.data).toEqual([]);
  });
});
