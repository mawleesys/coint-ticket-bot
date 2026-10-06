/**
 * Тесты для TicketMappingStore
 */

import { TicketMappingStore } from '../src/sync/mapping-store.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

describe('TicketMappingStore', () => {
  let store: TicketMappingStore;

  beforeEach(() => {
    store = new TicketMappingStore(logger);
  });

  describe('basic operations', () => {
    it('should store and retrieve mapping by ticket', () => {
      const mapping = {
        ticketNumber: 'COINT-100',
        threadId: 'thread-123',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      store.set(mapping);

      const retrieved = store.getByTicket('COINT-100');
      expect(retrieved).toEqual(mapping);
    });

    it('should retrieve ticket number by thread ID', () => {
      const mapping = {
        ticketNumber: 'COINT-200',
        threadId: 'thread-999',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      store.set(mapping);

      const ticketNumber = store.getTicketByThread('thread-999');
      expect(ticketNumber).toBe('COINT-200');
    });

    it('should return undefined for non-existent mappings', () => {
      expect(store.getByTicket('COINT-999')).toBeUndefined();
      expect(store.getTicketByThread('thread-999')).toBeUndefined();
    });
  });

  describe('updateLastSyncedMessage', () => {
    it('should update lastSyncedMessageId', () => {
      const mapping = {
        ticketNumber: 'COINT-300',
        threadId: 'thread-300',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      store.set(mapping);
      store.updateLastSyncedMessage('COINT-300', 42);

      const updated = store.getByTicket('COINT-300');
      expect(updated?.lastSyncedMessageId).toBe(42);
    });

    it('should not throw on non-existent ticket', () => {
      expect(() => {
        store.updateLastSyncedMessage('COINT-999', 1);
      }).not.toThrow();
    });
  });

  describe('existence checks', () => {
    beforeEach(() => {
      store.set({
        ticketNumber: 'COINT-400',
        threadId: 'thread-400',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should check if ticket exists', () => {
      expect(store.hasTicket('COINT-400')).toBe(true);
      expect(store.hasTicket('COINT-999')).toBe(false);
    });

    it('should check if thread exists', () => {
      expect(store.hasThread('thread-400')).toBe(true);
      expect(store.hasThread('thread-999')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all mappings', () => {
      store.set({
        ticketNumber: 'COINT-1',
        threadId: 'thread-1',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      store.set({
        ticketNumber: 'COINT-2',
        threadId: 'thread-2',
        channelId: 'channel-789',
        isConfidential: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((m) => m.ticketNumber)).toEqual(['COINT-1', 'COINT-2']);
    });
  });

  describe('delete', () => {
    it('should delete mapping', () => {
      store.set({
        ticketNumber: 'COINT-500',
        threadId: 'thread-500',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(store.hasTicket('COINT-500')).toBe(true);

      store.delete('COINT-500');

      expect(store.hasTicket('COINT-500')).toBe(false);
      expect(store.hasThread('thread-500')).toBe(false);
    });

    it('should not throw on non-existent ticket', () => {
      expect(() => {
        store.delete('COINT-999');
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all mappings', () => {
      store.set({
        ticketNumber: 'COINT-1',
        threadId: 'thread-1',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(store.getStats().totalMappings).toBe(1);

      store.clear();

      expect(store.getStats().totalMappings).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      expect(store.getStats().totalMappings).toBe(0);

      store.set({
        ticketNumber: 'COINT-1',
        threadId: 'thread-1',
        channelId: 'channel-456',
        isConfidential: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(store.getStats().totalMappings).toBe(1);
    });
  });
});
