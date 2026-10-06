/**
 * Правила обработки outbox: какие события зеркалить в Discord.
 */

import type { OutboxEvent } from '../types/api.js';

const STATE_EVENTS = new Set<string>([
  'status_changed',
  'resolved',
  'closed',
  'reopened',
  'priority_changed',
  'category_changed',
  'assigned',
  'unassigned',
  'team_changed',
]);

/**
 * Контент с source=discord не постим обратно (петля).
 * `internal_note_added` в ленте не бывает — на всякий случай игнорируем.
 */
export function shouldSkipMirrorEvent(event: OutboxEvent): boolean {
  if (event.event_type === 'internal_note_added') {
    return true;
  }
  return event.source === 'discord';
}

export function isCreatedEvent(event: OutboxEvent): boolean {
  return event.event_type === 'created';
}

export function isMessageEvent(event: OutboxEvent): boolean {
  return event.event_type === 'message_created';
}

export function isStateEvent(event: OutboxEvent): boolean {
  return STATE_EVENTS.has(event.event_type);
}

export function messageIsInternal(event: OutboxEvent): boolean {
  return event.payload.is_internal === true;
}
