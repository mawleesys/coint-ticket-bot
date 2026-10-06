/**
 * Site API client против mock HTTP-сервера по спецификации.
 */

import pino from 'pino';
import { SiteApiClient } from '../src/api/site-client.js';
import { createTestConfig } from '../src/config/index.js';
import {
  TicketApiError,
  TicketSource,
  TicketStatus,
} from '../src/types/api.js';
import {
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

  it('sends Bearer + Accept: application/json and creates a ticket', async () => {
    const created = await client.createTicket({
      user_id: 10,
      category_key: 'technical',
      subject: 'Тест API',
      body: 'Первое сообщение',
      source: TicketSource.Discord,
    });

    expect(created.public_number).toMatch(/^COINT-\d+$/);
    expect(created.status).toBe(TicketStatus.Open);
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

  it('shows a ticket and hides internal notes by default', async () => {
    const ticket = await client.getTicket('COINT-1207');
    expect(ticket.public_number).toBe('COINT-1207');
    expect(ticket.messages.every((message) => !message.is_internal)).toBe(true);
  });

  it('accepts legacy COI- number rewrite', async () => {
    const ticket = await client.getTicket('COI-1207');
    expect(ticket.public_number).toBe('COINT-1207');
  });

  it('adds a Discord-sourced message with external_message_id', async () => {
    const result = await client.addMessage('COINT-1207', {
      user_id: 5,
      body: 'Ответ из Discord',
      is_internal: false,
      external_message_id: '123456789012345678',
      source: TicketSource.Discord,
    });

    expect(result.id).toBeGreaterThan(0);
    expect(result.is_internal).toBe(false);

    const stored = server.getTicket('COINT-1207');
    const last = stored?.messages.at(-1);
    expect(last?.external_message_id).toBe('123456789012345678');
    expect(last?.source).toBe(TicketSource.Discord);
  });

  it('adds an internal note', async () => {
    const result = await client.addMessage('COINT-1207', {
      user_id: 5,
      body: 'Внутренняя заметка',
      is_internal: true,
      source: TicketSource.Discord,
    });
    expect(result.is_internal).toBe(true);

    const withInternal = await client.getTicket('COINT-1207', true);
    expect(withInternal.messages.some((message) => message.is_internal)).toBe(true);
  });

  it('changes status and stores a Discord thread reference', async () => {
    const updated = await client.changeStatus('COINT-1207', {
      status: TicketStatus.Resolved,
      user_id: 5,
    });
    expect(updated.status).toBe(TicketStatus.Resolved);

    const ref = await client.addReference('COINT-1207', {
      provider: 'discord',
      external_type: 'thread',
      external_id: '987654321098765432',
      metadata: { confidential: false },
    });
    expect(ref.provider).toBe('discord');
    expect(ref.external_type).toBe('thread');
  });

  it('maps 401 / 404 to TicketApiError', async () => {
    const badAuth = new SiteApiClient(
      createTestConfig({
        dryRun: false,
        site: { url: server.url, apiToken: 'wrong', apiTimeout: 5000 },
      }),
      logger
    );

    await expect(badAuth.getTicket('COINT-1207')).rejects.toBeInstanceOf(
      TicketApiError
    );
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
  });

  it('throws documented TODOs for planned endpoints behind feature flags', () => {
    expect(() => client.getUserByDiscordId('1')).toThrow(/gap #6/i);
    expect(() => client.getEventsSince(0)).toThrow(/FEATURE_SITE_EVENT_FEED/);
    expect(() => client.getCategories()).toThrow(/FEATURE_CATEGORIES_ENDPOINT/);
  });
});
