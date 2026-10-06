/**
 * Маршрутизация конфиденциальных тикетов.
 * Предпочитаем `is_sensitive` из API; ключ категории — запасной путь.
 */

import { KNOWN_CATEGORIES } from '../types/api.js';

export const CONFIDENTIAL_CATEGORY_KEYS = ['staff_complaint'] as const;

export interface ForumChannelIds {
  publicForumChannelId: string;
  confidentialForumChannelId: string;
}

export interface TicketRoute {
  channelId: string;
  isConfidential: boolean;
  reason: string;
}

export function isConfidentialCategory(categoryKey: string): boolean {
  const known = KNOWN_CATEGORIES[categoryKey];
  if (known) {
    return known.is_sensitive === true;
  }
  return (CONFIDENTIAL_CATEGORY_KEYS as readonly string[]).includes(categoryKey);
}

export function isTicketConfidential(ticket: {
  is_sensitive?: boolean;
  category: string;
}): boolean {
  if (typeof ticket.is_sensitive === 'boolean') {
    return ticket.is_sensitive;
  }
  return isConfidentialCategory(ticket.category);
}

/**
 * Выбирает форум для тикета. Конфиденциальные категории идут только
 * в закрытый канал; обычные — только в общий.
 */
export function routeTicketToForum(
  categoryKey: string,
  channels: ForumChannelIds,
  isSensitive?: boolean
): TicketRoute {
  const confidential =
    typeof isSensitive === 'boolean'
      ? isSensitive
      : isConfidentialCategory(categoryKey);
  if (confidential) {
    return {
      channelId: channels.confidentialForumChannelId,
      isConfidential: true,
      reason: `category "${categoryKey}" is sensitive; never mirror to the public forum`,
    };
  }

  return {
    channelId: channels.publicForumChannelId,
    isConfidential: false,
    reason: `category "${categoryKey}" is public`,
  };
}

/**
 * Защита от ошибочного зеркалирования: если тикет конфиденциальный,
 * целевой канал обязан быть закрытым форумом.
 */
export function assertConfidentialRoute(
  categoryKey: string,
  targetChannelId: string,
  channels: ForumChannelIds
): void {
  if (!isConfidentialCategory(categoryKey)) {
    return;
  }

  if (targetChannelId === channels.publicForumChannelId) {
    throw new Error(
      `Refusing to mirror confidential category "${categoryKey}" into the public forum`
    );
  }

  if (targetChannelId !== channels.confidentialForumChannelId) {
    throw new Error(
      `Confidential category "${categoryKey}" must go to the restricted forum`
    );
  }
}
