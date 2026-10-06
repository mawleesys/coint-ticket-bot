import { TicketSource } from '../src/types/api.js';
import { DedupeGuard } from '../src/sync/dedupe-guard.js';
import {
  isEmptyStaffBody,
  shouldIgnoreIncomingDiscordMessage,
  shouldSkipSiteEventToAvoidLoop,
} from '../src/sync/loop-guard.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

describe('loop and dedupe guards', () => {
  it('ignores bot authors', () => {
    expect(
      shouldIgnoreIncomingDiscordMessage({
        id: '1',
        content: 'hi',
        author: { id: 'bot-id', bot: true },
      })
    ).toBe(true);
  });

  it('ignores webhook authors even if they look like users', () => {
    expect(
      shouldIgnoreIncomingDiscordMessage({
        id: '2',
        content: 'webhook echo',
        author: { id: 'wh', bot: false, webhookId: 'webhook-1' },
      })
    ).toBe(true);
  });

  it('ignores the bot user id to avoid self-echo', () => {
    expect(
      shouldIgnoreIncomingDiscordMessage(
        {
          id: '3',
          content: 'self',
          author: { id: 'our-bot', bot: false },
        },
        'our-bot'
      )
    ).toBe(true);
  });

  it('accepts a real staff user message', () => {
    expect(
      shouldIgnoreIncomingDiscordMessage({
        id: '4',
        content: 'ответ',
        author: { id: 'staff-1', bot: false },
      })
    ).toBe(false);
  });

  it('skips site→Discord events that originated on Discord', () => {
    expect(
      shouldSkipSiteEventToAvoidLoop({ source: TicketSource.Discord })
    ).toBe(true);
    expect(
      shouldSkipSiteEventToAvoidLoop({ source: TicketSource.Website })
    ).toBe(false);
  });

  it('rejects empty bodies after !note stripping', () => {
    expect(isEmptyStaffBody('   ')).toBe(true);
    expect(isEmptyStaffBody('текст')).toBe(false);
  });

  it('dedupes by Discord message id so retries do not post twice', () => {
    const guard = new DedupeGuard(logger, 10);
    const snowflake = '123456789012345678';

    expect(guard.isProcessed(snowflake)).toBe(false);
    guard.markProcessed(snowflake);
    expect(guard.isProcessed(snowflake)).toBe(true);
    expect(guard.isProcessed('another')).toBe(false);
  });
});
