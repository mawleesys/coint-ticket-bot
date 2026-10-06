/**
 * Персистентный курсор outbox (`after_id`).
 * В dry-run или без пути — только память.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

export class EventCursorStore {
  private afterId = 0;

  constructor(
    private readonly filePath: string | null,
    private readonly logger: Logger
  ) {
    this.afterId = this.readFromDisk();
  }

  get(): number {
    return this.afterId;
  }

  set(id: number): void {
    if (id < this.afterId) {
      return;
    }
    this.afterId = id;
    this.persist();
  }

  clear(): void {
    this.afterId = 0;
    this.persist();
  }

  private readFromDisk(): number {
    if (!this.filePath) {
      return 0;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { afterId?: number };
      return typeof parsed.afterId === 'number' && parsed.afterId >= 0
        ? parsed.afterId
        : 0;
    } catch {
      return 0;
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify({ afterId: this.afterId }, null, 2),
        'utf8'
      );
    } catch (error) {
      this.logger.warn({ error, path: this.filePath }, 'Failed to persist event cursor');
    }
  }
}
