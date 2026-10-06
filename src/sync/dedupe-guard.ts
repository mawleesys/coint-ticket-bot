/**
 * Dedupe guard: защита от дублирования сообщений и петель
 */

import type { Logger } from 'pino';

interface ProcessedMessage {
  externalMessageId: string;
  timestamp: number;
}

/**
 * Защита от:
 * - Дублирования при retry
 * - Петель (Discord → Site → Webhook → Discord)
 * - Повторной обработки при рестарте
 */
export class DedupeGuard {
  private processedMessages: Map<string, ProcessedMessage> = new Map();
  private readonly ttlMs: number;

  constructor(
    private readonly logger: Logger,
    ttlMinutes = 60
  ) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /**
   * Проверяет, было ли сообщение уже обработано
   */
  isProcessed(externalMessageId: string): boolean {
    const record = this.processedMessages.get(externalMessageId);

    if (!record) {
      return false;
    }

    // Проверяем TTL
    if (Date.now() - record.timestamp > this.ttlMs) {
      this.processedMessages.delete(externalMessageId);
      return false;
    }

    return true;
  }

  /**
   * Помечает сообщение как обработанное
   */
  markProcessed(externalMessageId: string): void {
    this.processedMessages.set(externalMessageId, {
      externalMessageId,
      timestamp: Date.now(),
    });

    this.logger.trace(
      { externalMessageId },
      'Marked message as processed'
    );
  }

  /**
   * Очищает устаревшие записи
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, record] of this.processedMessages.entries()) {
      if (now - record.timestamp > this.ttlMs) {
        this.processedMessages.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(
        { removed, remaining: this.processedMessages.size },
        'Cleaned up old dedupe records'
      );
    }
  }

  /**
   * Запускает периодическую очистку
   */
  startCleanupInterval(intervalMinutes = 10): NodeJS.Timeout {
    return setInterval(() => {
      this.cleanup();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Возвращает статистику
   */
  getStats(): { totalRecords: number } {
    return {
      totalRecords: this.processedMessages.size,
    };
  }

  /**
   * Очищает все записи (для тестов)
   */
  clear(): void {
    this.processedMessages.clear();
  }
}
