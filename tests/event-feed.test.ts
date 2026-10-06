import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { EventCursorStore } from '../src/sync/event-cursor.js';
import {
  isCreatedEvent,
  isMessageEvent,
  shouldSkipMirrorEvent,
} from '../src/sync/event-feed.js';
import {
  TicketEventType,
  TicketSource,
  type OutboxEvent,
} from '../src/types/api.js';

const logger = pino({ level: 'silent' });

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 1,
    ticket_id: 207,
    ticket_number: 'COINT-1207',
    category: 'technical',
    is_sensitive: false,
    event_type: TicketEventType.MessageCreated,
    source: TicketSource.Website,
    actor_user_id: 45,
    message_id: 901,
    payload: { author_type: 'staff', is_internal: false },
    created_at: '2026-10-06T10:00:00+05:00',
    ...overrides,
  };
}

describe('event feed rules', () => {
  it('skips source=discord to avoid loops', () => {
    expect(
      shouldSkipMirrorEvent(event({ source: TicketSource.Discord }))
    ).toBe(true);
    expect(
      shouldSkipMirrorEvent(event({ source: TicketSource.Website }))
    ).toBe(false);
  });

  it('never mirrors internal_note_added even if it appeared', () => {
    expect(
      shouldSkipMirrorEvent(
        event({ event_type: TicketEventType.InternalNoteAdded })
      )
    ).toBe(true);
  });

  it('classifies created vs message_created', () => {
    expect(isCreatedEvent(event({ event_type: TicketEventType.Created }))).toBe(
      true
    );
    expect(isMessageEvent(event())).toBe(true);
    expect(
      isMessageEvent(event({ event_type: TicketEventType.Created }))
    ).toBe(false);
  });
});

describe('event cursor store', () => {
  it('persists after_id to disk and reloads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coint-cursor-'));
    const file = join(dir, 'cursor.json');
    mkdirSync(dir, { recursive: true });

    const store = new EventCursorStore(file, logger);
    expect(store.get()).toBe(0);
    store.set(1842);
    expect(store.get()).toBe(1842);

    const reloaded = new EventCursorStore(file, logger);
    expect(reloaded.get()).toBe(1842);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ afterId: 1842 });

    rmSync(dir, { recursive: true, force: true });
  });

  it('stays in memory when no path is given (dry-run)', () => {
    const store = new EventCursorStore(null, logger);
    store.set(10);
    expect(store.get()).toBe(10);
  });
});
