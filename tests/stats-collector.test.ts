/**
 * Тесты для StatsCollector
 */

import { StatsCollector } from '../src/stats/collector.js';
import { TicketPriority } from '../src/types/api.js';
import { createTestConfig } from '../src/config/index.js';
import type { TicketMetrics } from '../src/types/discord.js';
import pino from 'pino';

const mockConfig = createTestConfig();

const logger = pino({ level: 'silent' });

describe('StatsCollector', () => {
  let collector: StatsCollector;

  beforeEach(() => {
    collector = new StatsCollector(mockConfig, logger);
  });

  describe('recordTicketMetrics', () => {
    it('should record ticket metrics', () => {
      const metrics: TicketMetrics = {
        ticketNumber: 'COINT-100',
        category: 'technical',
        priority: TicketPriority.Normal,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        staffRepliesCount: 0,
        userRepliesCount: 0,
      };

      collector.recordTicketMetrics(metrics);

      expect(collector.getModuleStats().totalMetrics).toBe(1);
    });
  });

  describe('recordFirstResponse', () => {
    it('should calculate first response time', () => {
      const createdAt = new Date('2026-10-01T10:00:00Z');
      const firstResponseAt = new Date('2026-10-01T10:30:00Z');

      const metrics: TicketMetrics = {
        ticketNumber: 'COINT-200',
        category: 'technical',
        priority: TicketPriority.High,
        createdAt,
        staffRepliesCount: 1,
        userRepliesCount: 0,
      };

      collector.recordTicketMetrics(metrics);
      collector.recordFirstResponse('COINT-200', firstResponseAt);

      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      expect(stats.avgFirstResponseTimeMinutes).toBe(30);
    });

    it('should not overwrite existing first response', () => {
      const metrics: TicketMetrics = {
        ticketNumber: 'COINT-300',
        category: 'technical',
        priority: TicketPriority.Normal,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        firstResponseAt: new Date('2026-10-01T10:15:00Z'),
        firstResponseTimeMinutes: 15,
        staffRepliesCount: 1,
        userRepliesCount: 0,
      };

      collector.recordTicketMetrics(metrics);
      collector.recordFirstResponse(
        'COINT-300',
        new Date('2026-10-01T11:00:00Z')
      );

      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      expect(stats.avgFirstResponseTimeMinutes).toBe(15); // Should keep original
    });
  });

  describe('calculateStats', () => {
    beforeEach(() => {
      // Ticket 1: Normal priority, quick response
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-1',
        category: 'technical',
        priority: TicketPriority.Normal,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        firstResponseAt: new Date('2026-10-01T10:15:00Z'),
        firstResponseTimeMinutes: 15,
        resolvedAt: new Date('2026-10-01T12:00:00Z'),
        resolutionTimeMinutes: 120,
        staffRepliesCount: 3,
        userRepliesCount: 2,
      });

      // Ticket 2: High priority, slow response
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-2',
        category: 'shop_payment',
        priority: TicketPriority.High,
        createdAt: new Date('2026-10-01T14:00:00Z'),
        firstResponseAt: new Date('2026-10-01T18:00:00Z'),
        firstResponseTimeMinutes: 240,
        staffRepliesCount: 1,
        userRepliesCount: 1,
      });

      // Ticket 3: Outside period
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-3',
        category: 'technical',
        priority: TicketPriority.Low,
        createdAt: new Date('2026-09-30T10:00:00Z'),
        staffRepliesCount: 0,
        userRepliesCount: 1,
      });
    });

    it('should calculate stats for period', () => {
      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      expect(stats.totalTickets).toBe(2);
      expect(stats.resolvedTickets).toBe(1);
      expect(stats.avgFirstResponseTimeMinutes).toBe((15 + 240) / 2);
      expect(stats.medianFirstResponseTimeMinutes).toBe((15 + 240) / 2);
    });

    it('should calculate median correctly with odd number of values', () => {
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-4',
        category: 'technical',
        priority: TicketPriority.Normal,
        createdAt: new Date('2026-10-01T16:00:00Z'),
        firstResponseAt: new Date('2026-10-01T16:45:00Z'),
        firstResponseTimeMinutes: 45,
        staffRepliesCount: 2,
        userRepliesCount: 1,
      });

      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      // Values: 15, 45, 240 → median = 45
      expect(stats.medianFirstResponseTimeMinutes).toBe(45);
    });

    it('should group tickets by category', () => {
      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      expect(stats.byCategory['technical']).toBe(1);
      expect(stats.byCategory['shop_payment']).toBe(1);
    });

    it('should group tickets by priority', () => {
      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      expect(stats.byPriority[TicketPriority.Normal]).toBe(1);
      expect(stats.byPriority[TicketPriority.High]).toBe(1);
      expect(stats.byPriority[TicketPriority.Low]).toBe(0);
    });

    it('should return empty stats for empty period', () => {
      const stats = collector.calculateStats(
        new Date('2026-11-01'),
        new Date('2026-11-02')
      );

      expect(stats.totalTickets).toBe(0);
      expect(stats.avgFirstResponseTimeMinutes).toBe(0);
    });
  });

  describe('SLA compliance', () => {
    it('should calculate SLA compliance correctly', () => {
      // Urgent: within SLA (60 min)
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-U1',
        category: 'technical',
        priority: TicketPriority.Urgent,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        firstResponseAt: new Date('2026-10-01T10:30:00Z'),
        firstResponseTimeMinutes: 30,
        staffRepliesCount: 1,
        userRepliesCount: 0,
      });

      // Urgent: outside SLA
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-U2',
        category: 'technical',
        priority: TicketPriority.Urgent,
        createdAt: new Date('2026-10-01T11:00:00Z'),
        firstResponseAt: new Date('2026-10-01T13:00:00Z'),
        firstResponseTimeMinutes: 120,
        staffRepliesCount: 1,
        userRepliesCount: 0,
      });

      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-02')
      );

      // 50% compliance (1 out of 2)
      expect(stats.slaCompliance.urgent).toBe(50);
    });
  });

  describe('formatStatsForDiscord', () => {
    it('should format stats as Discord message', () => {
      const stats = collector.calculateStats(
        new Date('2026-10-01'),
        new Date('2026-10-07')
      );

      const formatted = collector.formatStatsForDiscord(stats);

      expect(formatted).toContain('Статистика за период');
      expect(formatted).toContain('Всего тикетов');
      expect(formatted).toContain('SLA соответствие');
    });
  });

  describe('clear', () => {
    it('should clear all metrics', () => {
      collector.recordTicketMetrics({
        ticketNumber: 'COINT-1',
        category: 'technical',
        priority: TicketPriority.Normal,
        createdAt: new Date(),
        staffRepliesCount: 0,
        userRepliesCount: 0,
      });

      expect(collector.getModuleStats().totalMetrics).toBe(1);

      collector.clear();

      expect(collector.getModuleStats().totalMetrics).toBe(0);
    });
  });
});
