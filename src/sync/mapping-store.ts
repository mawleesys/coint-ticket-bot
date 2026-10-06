/**
 * Хранилище маппинга тикет ↔ Discord тред
 * Временная реализация в памяти до добавления персистентного хранилища
 */

import type { Logger } from 'pino';
import type { TicketThreadMapping } from '../types/discord.js';

/**
 * ВАЖНО: Это простая реализация в памяти для MVP
 * В продакшене требуется:
 * - БД (SQLite/PostgreSQL) или
 * - Использование site API references для персистентности
 */
export class TicketMappingStore {
  private ticketToThread: Map<string, TicketThreadMapping> = new Map();
  private threadToTicket: Map<string, string> = new Map();

  constructor(private readonly logger: Logger) {}

  /**
   * Сохраняет маппинг тикета на тред
   */
  set(mapping: TicketThreadMapping): void {
    this.ticketToThread.set(mapping.ticketNumber, mapping);
    this.threadToTicket.set(mapping.threadId, mapping.ticketNumber);

    this.logger.debug(
      {
        ticket: mapping.ticketNumber,
        thread: mapping.threadId,
      },
      'Stored ticket mapping'
    );
  }

  /**
   * Получает маппинг по номеру тикета
   */
  getByTicket(ticketNumber: string): TicketThreadMapping | undefined {
    return this.ticketToThread.get(ticketNumber);
  }

  /**
   * Получает номер тикета по ID треда
   */
  getTicketByThread(threadId: string): string | undefined {
    return this.threadToTicket.get(threadId);
  }

  /**
   * Обновляет lastSyncedMessageId для тикета
   */
  updateLastSyncedMessage(
    ticketNumber: string,
    messageId: number
  ): void {
    const mapping = this.ticketToThread.get(ticketNumber);
    if (mapping) {
      mapping.lastSyncedMessageId = messageId;
      mapping.updatedAt = new Date();
      this.ticketToThread.set(ticketNumber, mapping);
    }
  }

  /**
   * Возвращает все маппинги
   */
  getAll(): TicketThreadMapping[] {
    return Array.from(this.ticketToThread.values());
  }

  /**
   * Проверяет, существует ли маппинг для тикета
   */
  hasTicket(ticketNumber: string): boolean {
    return this.ticketToThread.has(ticketNumber);
  }

  /**
   * Проверяет, существует ли маппинг для треда
   */
  hasThread(threadId: string): boolean {
    return this.threadToTicket.has(threadId);
  }

  /**
   * Удаляет маппинг (например, при закрытии/архивации)
   */
  delete(ticketNumber: string): void {
    const mapping = this.ticketToThread.get(ticketNumber);
    if (mapping) {
      this.threadToTicket.delete(mapping.threadId);
      this.ticketToThread.delete(ticketNumber);

      this.logger.debug({ ticket: ticketNumber }, 'Deleted ticket mapping');
    }
  }

  /**
   * Очищает все маппинги (для тестов)
   */
  clear(): void {
    this.ticketToThread.clear();
    this.threadToTicket.clear();
  }

  /**
   * Возвращает статистику хранилища
   */
  getStats(): { totalMappings: number } {
    return {
      totalMappings: this.ticketToThread.size,
    };
  }
}
