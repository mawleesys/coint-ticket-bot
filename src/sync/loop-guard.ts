/**
 * Защита от петель Discord ↔ сайт и повторной обработки.
 *
 * Правила:
 * - игнорировать сообщения бота и webhook-авторов;
 * - не зеркалировать на Discord события, которые сами пришли из Discord;
 * - не слать на сайт сообщение, если его external_message_id уже известен.
 */

import { TicketSource } from '../types/api.js';

export interface IncomingDiscordAuthor {
  id: string;
  bot: boolean;
  webhookId?: string | null;
  system?: boolean;
}

export interface IncomingDiscordMessage {
  id: string;
  content: string;
  author: IncomingDiscordAuthor;
}

export function isBotOrWebhookAuthor(
  author: IncomingDiscordAuthor,
  botUserId?: string
): boolean {
  if (author.bot || author.system === true) {
    return true;
  }
  if (author.webhookId) {
    return true;
  }
  if (botUserId && author.id === botUserId) {
    return true;
  }
  return false;
}

/**
 * Сообщение из Discord, которое нельзя отправлять на сайт.
 */
export function shouldIgnoreIncomingDiscordMessage(
  message: IncomingDiscordMessage,
  botUserId?: string
): boolean {
  return isBotOrWebhookAuthor(message.author, botUserId);
}

/**
 * Событие сайта, которое нельзя постить в Discord (иначе петля).
 * Outbox обязан отдавать source (gap #5); пока source нет — бот
 * дополнительно смотрит external_message_id.
 */
export function shouldSkipSiteEventToAvoidLoop(event: {
  source?: TicketSource | string;
  externalMessageId?: string | null;
}): boolean {
  if (event.source === TicketSource.Discord || event.source === 'discord') {
    return true;
  }
  return false;
}

/**
 * Тело, которое нельзя отправлять на сайт (пустое после trim / только префикс).
 */
export function isEmptyStaffBody(body: string): boolean {
  return body.trim().length === 0;
}
