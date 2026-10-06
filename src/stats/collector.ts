/**
 * Модуль сбора и анализа статистики по тикетам
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import type {
  TicketMetrics,
  AggregatedStats,
  StaffStats,
} from '../types/discord.js';
import { TicketPriority } from '../types/api.js';

/**
 * Скелет модуля статистики
 * Реализация для реальных данных будет добавлена позже
 */
export class StatsCollector {
  private metrics: Map<string, TicketMetrics> = new Map();

  constructor(
    _config: Config,
    private readonly logger: Logger
  ) {}

  // ====================================
  // Data Collection
  // ====================================

  /**
   * Записывает метрики тикета
   */
  recordTicketMetrics(metrics: TicketMetrics): void {
    this.metrics.set(metrics.ticketNumber, metrics);

    this.logger.trace(
      { ticket: metrics.ticketNumber },
      'Recorded ticket metrics'
    );
  }

  /**
   * Обновляет время первого ответа
   */
  recordFirstResponse(ticketNumber: string, timestamp: Date): void {
    const metrics = this.metrics.get(ticketNumber);
    if (metrics && !metrics.firstResponseAt) {
      metrics.firstResponseAt = timestamp;

      const responseTimeMs =
        timestamp.getTime() - metrics.createdAt.getTime();
      metrics.firstResponseTimeMinutes = Math.floor(responseTimeMs / 60000);

      this.logger.debug(
        {
          ticket: ticketNumber,
          responseTimeMinutes: metrics.firstResponseTimeMinutes,
        },
        'Recorded first response time'
      );
    }
  }

  /**
   * Обновляет время решения тикета
   */
  recordResolution(ticketNumber: string, timestamp: Date): void {
    const metrics = this.metrics.get(ticketNumber);
    if (metrics && !metrics.resolvedAt) {
      metrics.resolvedAt = timestamp;

      const resolutionTimeMs =
        timestamp.getTime() - metrics.createdAt.getTime();
      metrics.resolutionTimeMinutes = Math.floor(resolutionTimeMs / 60000);

      this.logger.debug(
        {
          ticket: ticketNumber,
          resolutionTimeMinutes: metrics.resolutionTimeMinutes,
        },
        'Recorded resolution time'
      );
    }
  }

  /**
   * Инкрементирует счетчик ответов персонала
   */
  incrementStaffReplies(ticketNumber: string): void {
    const metrics = this.metrics.get(ticketNumber);
    if (metrics) {
      metrics.staffRepliesCount++;
    }
  }

  /**
   * Инкрементирует счетчик ответов пользователя
   */
  incrementUserReplies(ticketNumber: string): void {
    const metrics = this.metrics.get(ticketNumber);
    if (metrics) {
      metrics.userRepliesCount++;
    }
  }

  // ====================================
  // Aggregation & Analysis
  // ====================================

  /**
   * Вычисляет агрегированную статистику за период
   */
  calculateStats(start: Date, end: Date): AggregatedStats {
    const periodMetrics = Array.from(this.metrics.values()).filter(
      (m) => m.createdAt >= start && m.createdAt <= end
    );

    if (periodMetrics.length === 0) {
      return this.getEmptyStats(start, end);
    }

    const resolvedMetrics = periodMetrics.filter((m) => m.resolvedAt);
    const closedMetrics = periodMetrics.filter((m) => m.closedAt);

    const firstResponseTimes = periodMetrics
      .filter((m) => m.firstResponseTimeMinutes !== undefined)
      .map((m) => m.firstResponseTimeMinutes!);

    const resolutionTimes = resolvedMetrics
      .filter((m) => m.resolutionTimeMinutes !== undefined)
      .map((m) => m.resolutionTimeMinutes!);

    return {
      period: { start, end },
      totalTickets: periodMetrics.length,
      resolvedTickets: resolvedMetrics.length,
      closedTickets: closedMetrics.length,
      avgFirstResponseTimeMinutes: this.average(firstResponseTimes),
      medianFirstResponseTimeMinutes: this.median(firstResponseTimes),
      avgResolutionTimeMinutes: this.average(resolutionTimes),
      medianResolutionTimeMinutes: this.median(resolutionTimes),
      slaCompliance: this.calculateSLACompliance(periodMetrics),
      byCategory: this.groupByCategory(periodMetrics),
      byPriority: this.groupByPriority(periodMetrics),
      byStaff: this.groupByStaff(periodMetrics),
    };
  }

  private getEmptyStats(start: Date, end: Date): AggregatedStats {
    return {
      period: { start, end },
      totalTickets: 0,
      resolvedTickets: 0,
      closedTickets: 0,
      avgFirstResponseTimeMinutes: 0,
      medianFirstResponseTimeMinutes: 0,
      avgResolutionTimeMinutes: 0,
      medianResolutionTimeMinutes: 0,
      slaCompliance: {
        low: 100,
        normal: 100,
        high: 100,
        urgent: 100,
      },
      byCategory: {},
      byPriority: {
        [TicketPriority.Low]: 0,
        [TicketPriority.Normal]: 0,
        [TicketPriority.High]: 0,
        [TicketPriority.Urgent]: 0,
      },
      byStaff: {},
    };
  }

  private calculateSLACompliance(
    metrics: TicketMetrics[]
  ): AggregatedStats['slaCompliance'] {
    // SLA таргеты из конфига сайта (support.sla.{priority}_minutes)
    const slaTargets: Record<TicketPriority, number> = {
      [TicketPriority.Low]: 2880,
      [TicketPriority.Normal]: 1440,
      [TicketPriority.High]: 240,
      [TicketPriority.Urgent]: 60,
    };

    const compliance: AggregatedStats['slaCompliance'] = {
      low: 0,
      normal: 0,
      high: 0,
      urgent: 0,
    };

    const priorities: TicketPriority[] = [
      TicketPriority.Low,
      TicketPriority.Normal,
      TicketPriority.High,
      TicketPriority.Urgent,
    ];

    for (const priority of priorities) {
      const priorityMetrics = metrics.filter(
        (m) =>
          m.priority === priority && m.firstResponseTimeMinutes !== undefined
      );

      if (priorityMetrics.length === 0) {
        compliance[priority] = 100;
        continue;
      }

      const slaTarget = slaTargets[priority];
      const withinSLA = priorityMetrics.filter(
        (m) => (m.firstResponseTimeMinutes ?? Number.POSITIVE_INFINITY) <= slaTarget
      ).length;

      compliance[priority] = (withinSLA / priorityMetrics.length) * 100;
    }

    return compliance;
  }

  private groupByCategory(metrics: TicketMetrics[]): Record<string, number> {
    const groups: Record<string, number> = {};
    metrics.forEach((m) => {
      groups[m.category] = (groups[m.category] || 0) + 1;
    });
    return groups;
  }

  private groupByPriority(
    metrics: TicketMetrics[]
  ): Record<TicketPriority, number> {
    return {
      [TicketPriority.Low]: metrics.filter((m) => m.priority === TicketPriority.Low)
        .length,
      [TicketPriority.Normal]: metrics.filter(
        (m) => m.priority === TicketPriority.Normal
      ).length,
      [TicketPriority.High]: metrics.filter((m) => m.priority === TicketPriority.High)
        .length,
      [TicketPriority.Urgent]: metrics.filter(
        (m) => m.priority === TicketPriority.Urgent
      ).length,
    };
  }

  private groupByStaff(metrics: TicketMetrics[]): Record<number, StaffStats> {
    const staffMap: Record<number, StaffStats> = {};

    metrics.forEach((m) => {
      if (m.assignedStaffId) {
        if (!staffMap[m.assignedStaffId]) {
          staffMap[m.assignedStaffId] = {
            staffId: m.assignedStaffId,
            staffName: `Staff ${m.assignedStaffId}`, // TODO: получать имя через API
            repliesCount: 0,
            ticketsHandled: 0,
            avgResponseTimeMinutes: 0,
          };
        }

        staffMap[m.assignedStaffId].ticketsHandled++;
        staffMap[m.assignedStaffId].repliesCount += m.staffRepliesCount;
      }
    });

    // Вычисляем средние времена ответа
    Object.values(staffMap).forEach((staff) => {
      const staffMetrics = metrics.filter(
        (m) => m.assignedStaffId === staff.staffId && m.firstResponseTimeMinutes
      );

      if (staffMetrics.length > 0) {
        const times = staffMetrics.map((m) => m.firstResponseTimeMinutes!);
        staff.avgResponseTimeMinutes = this.average(times);
      }
    });

    return staffMap;
  }

  // ====================================
  // Utilities
  // ====================================

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  private median(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
  }

  /**
   * Форматирует статистику для Discord embed
   */
  formatStatsForDiscord(stats: AggregatedStats): string {
    const lines: string[] = [
      `📊 **Статистика за период**`,
      `${stats.period.start.toLocaleDateString('ru')} – ${stats.period.end.toLocaleDateString('ru')}`,
      '',
      `**Общее:**`,
      `• Всего тикетов: ${stats.totalTickets}`,
      `• Решено: ${stats.resolvedTickets}`,
      `• Закрыто: ${stats.closedTickets}`,
      '',
      `**Время ответа:**`,
      `• Среднее: ${Math.round(stats.avgFirstResponseTimeMinutes)} мин`,
      `• Медиана: ${Math.round(stats.medianFirstResponseTimeMinutes)} мин`,
      '',
      `**Время решения:**`,
      `• Среднее: ${Math.round(stats.avgResolutionTimeMinutes)} мин`,
      `• Медиана: ${Math.round(stats.medianResolutionTimeMinutes)} мин`,
      '',
      `**SLA соответствие:**`,
      `• 🟢 Низкий: ${stats.slaCompliance.low.toFixed(1)}%`,
      `• 🟡 Обычный: ${stats.slaCompliance.normal.toFixed(1)}%`,
      `• 🟠 Высокий: ${stats.slaCompliance.high.toFixed(1)}%`,
      `• 🔴 Срочный: ${stats.slaCompliance.urgent.toFixed(1)}%`,
    ];

    return lines.join('\n');
  }

  /**
   * Возвращает статистику модуля
   */
  getModuleStats(): { totalMetrics: number } {
    return {
      totalMetrics: this.metrics.size,
    };
  }

  /**
   * Очищает все метрики (для тестов)
   */
  clear(): void {
    this.metrics.clear();
  }
}
