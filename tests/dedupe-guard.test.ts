/**
 * Тесты для DedupeGuard
 */

import { DedupeGuard } from '../src/sync/dedupe-guard.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

describe('DedupeGuard', () => {
  let guard: DedupeGuard;

  beforeEach(() => {
    guard = new DedupeGuard(logger, 1); // 1 minute TTL for tests
  });

  describe('basic deduplication', () => {
    it('should mark message as processed', () => {
      const messageId = 'msg-123';

      expect(guard.isProcessed(messageId)).toBe(false);

      guard.markProcessed(messageId);

      expect(guard.isProcessed(messageId)).toBe(true);
    });

    it('should handle multiple different messages', () => {
      guard.markProcessed('msg-1');
      guard.markProcessed('msg-2');
      guard.markProcessed('msg-3');

      expect(guard.isProcessed('msg-1')).toBe(true);
      expect(guard.isProcessed('msg-2')).toBe(true);
      expect(guard.isProcessed('msg-3')).toBe(true);
      expect(guard.isProcessed('msg-4')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should expire old records based on TTL', () => {
      const guardShortTtl = new DedupeGuard(logger, 0.01); // ~600ms

      guardShortTtl.markProcessed('msg-old');

      expect(guardShortTtl.isProcessed('msg-old')).toBe(true);

      // Wait for TTL to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(guardShortTtl.isProcessed('msg-old')).toBe(false);
          resolve();
        }, 700);
      });
    });
  });

  describe('cleanup', () => {
    it('should remove expired records on cleanup', () => {
      const guardShortTtl = new DedupeGuard(logger, 0.01); // ~600ms

      guardShortTtl.markProcessed('msg-expired-1');
      guardShortTtl.markProcessed('msg-expired-2');

      expect(guardShortTtl.getStats().totalRecords).toBe(2);

      // Wait and cleanup
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          guardShortTtl.cleanup();
          expect(guardShortTtl.getStats().totalRecords).toBe(0);
          resolve();
        }, 700);
      });
    });

    it('should keep fresh records during cleanup', () => {
      guard.markProcessed('msg-fresh');

      expect(guard.getStats().totalRecords).toBe(1);

      guard.cleanup();

      expect(guard.getStats().totalRecords).toBe(1);
      expect(guard.isProcessed('msg-fresh')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all records', () => {
      guard.markProcessed('msg-1');
      guard.markProcessed('msg-2');

      expect(guard.getStats().totalRecords).toBe(2);

      guard.clear();

      expect(guard.getStats().totalRecords).toBe(0);
      expect(guard.isProcessed('msg-1')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      expect(guard.getStats().totalRecords).toBe(0);

      guard.markProcessed('msg-1');
      expect(guard.getStats().totalRecords).toBe(1);

      guard.markProcessed('msg-2');
      expect(guard.getStats().totalRecords).toBe(2);
    });
  });

  describe('loop prevention scenario', () => {
    it('should prevent processing same Discord message twice', () => {
      const discordMessageId = '1234567890123456789';

      // First processing
      expect(guard.isProcessed(discordMessageId)).toBe(false);
      guard.markProcessed(discordMessageId);

      // Webhook fires again (shouldn't happen but protection exists)
      expect(guard.isProcessed(discordMessageId)).toBe(true);

      // Another message should still work
      expect(guard.isProcessed('9876543210987654321')).toBe(false);
    });
  });
});
