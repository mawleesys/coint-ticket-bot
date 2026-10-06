/**
 * Маршрутизация конфиденциальных тикетов.
 *
 * Сайт не отдаёт is_sensitive в payload (gap #7), поэтому бот решает
 * по ключу категории. Жалобы на администрацию никогда не зеркалируются
 * в общий форум.
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

/**
 * Выбирает форум для тикета. Конфиденциальные категории идут только
 * в закрытый канал; обычные — только в общий.
 */
export function routeTicketToForum(
  categoryKey: string,
  channels: ForumChannelIds
): TicketRoute {
  if (isConfidentialCategory(categoryKey)) {
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
