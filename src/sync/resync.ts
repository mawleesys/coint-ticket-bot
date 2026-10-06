/**
 * Resync, когда outbox уже почистили (retention 90 дней) или курсор старше ленты.
 */

export const DEFAULT_OUTBOX_RETENTION_DAYS = 90;

export function needsResync(input: {
  afterId: number;
  lastSyncAt: Date | null;
  oldestEventId: number | null;
  retentionDays?: number;
  now?: Date;
}): boolean {
  const retentionDays = input.retentionDays ?? DEFAULT_OUTBOX_RETENTION_DAYS;
  const now = input.now ?? new Date();

  if (input.lastSyncAt) {
    const ageMs = now.getTime() - input.lastSyncAt.getTime();
    if (ageMs > retentionDays * 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  if (
    input.afterId > 0 &&
    input.oldestEventId !== null &&
    input.afterId + 1 < input.oldestEventId
  ) {
    return true;
  }

  return false;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
