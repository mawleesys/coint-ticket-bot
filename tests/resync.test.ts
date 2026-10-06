import { actionFromTicketButton } from '../src/sync/ticket-actions.js';
import { needsResync, toDateOnly } from '../src/sync/resync.js';
import { TicketButtonId } from '../src/types/discord.js';
import { TicketPriority, TicketStatus } from '../src/types/api.js';

describe('needsResync', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('is false for a fresh cursor', () => {
    expect(
      needsResync({
        afterId: 100,
        lastSyncAt: new Date('2026-10-06T11:00:00Z'),
        oldestEventId: 50,
        now,
      })
    ).toBe(false);
  });

  it('is true when last sync is older than retention', () => {
    expect(
      needsResync({
        afterId: 100,
        lastSyncAt: new Date('2026-06-01T00:00:00Z'),
        oldestEventId: 50,
        retentionDays: 90,
        now,
      })
    ).toBe(true);
  });

  it('is true when stored cursor is behind the oldest remaining event', () => {
    expect(
      needsResync({
        afterId: 100,
        lastSyncAt: new Date('2026-10-06T11:00:00Z'),
        oldestEventId: 5000,
        now,
      })
    ).toBe(true);
  });

  it('is false when afterId is immediately before the oldest event', () => {
    expect(
      needsResync({
        afterId: 4999,
        lastSyncAt: new Date('2026-10-06T11:00:00Z'),
        oldestEventId: 5000,
        now,
      })
    ).toBe(false);
  });

  it('formats YYYY-MM-DD', () => {
    expect(toDateOnly(new Date('2026-10-06T10:00:00Z'))).toBe('2026-10-06');
  });
});

describe('ticket card buttons', () => {
  it('maps take / resolve / close / priority', () => {
    expect(actionFromTicketButton(TicketButtonId.Take)).toEqual({
      kind: 'claim',
    });
    expect(actionFromTicketButton(TicketButtonId.Resolve)).toEqual({
      kind: 'status',
      status: TicketStatus.Resolved,
    });
    expect(actionFromTicketButton(TicketButtonId.Close)).toEqual({
      kind: 'status',
      status: TicketStatus.Closed,
    });
    expect(actionFromTicketButton(TicketButtonId.PriorityUrgent)).toEqual({
      kind: 'priority',
      priority: TicketPriority.Urgent,
    });
    expect(actionFromTicketButton('unknown')).toEqual({ kind: 'unknown' });
  });
});
