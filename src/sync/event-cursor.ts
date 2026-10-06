/**
 * Персистентный курсор outbox (`after_id` + `lastSyncAt`).
 * В dry-run или без пути — только память.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

export interface EventCursorState {
  afterId: number;
  lastSyncAt: string | null;
}

export class EventCursorStore {
  private afterId = 0;
  private lastSyncAt: Date | null = null;

  constructor(
    private readonly filePath: string | null,
    private readonly logger: Logger
  ) {
    const loaded = this.readFromDisk();
    this.afterId = loaded.afterId;
    this.lastSyncAt = loaded.lastSyncAt
      ? new Date(loaded.lastSyncAt)
      : null;
  }

  get(): number {
    return this.afterId;
  }

  getLastSyncAt(): Date | null {
    return this.lastSyncAt;
  }

  set(id: number): void {
    if (id < this.afterId) {
      return;
    }
    this.afterId = id;
    this.lastSyncAt = new Date();
    this.persist();
  }

  /** Успешный цикл поллинга, даже если новых событий не было. */
  markSynced(at: Date = new Date()): void {
    this.lastSyncAt = at;
    this.persist();
  }

  clear(): void {
    this.afterId = 0;
    this.lastSyncAt = null;
    this.persist();
  }

  private readFromDisk(): EventCursorState {
    if (!this.filePath) {
      return { afterId: 0, lastSyncAt: null };
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        afterId?: number;
        lastSyncAt?: string | null;
      };
      return {
        afterId:
          typeof parsed.afterId === 'number' && parsed.afterId >= 0
            ? parsed.afterId
            : 0,
        lastSyncAt:
          typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
      };
    } catch {
      return { afterId: 0, lastSyncAt: null };
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const payload: EventCursorState = {
        afterId: this.afterId,
        lastSyncAt: this.lastSyncAt ? this.lastSyncAt.toISOString() : null,
      };
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn({ error, path: this.filePath }, 'Failed to persist event cursor');
    }
  }
}
