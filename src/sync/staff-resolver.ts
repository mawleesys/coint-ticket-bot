/**
 * Резолв Discord user → аккаунт сайта и проверка прав staff.
 */

import type { SiteApiClient } from '../api/site-client.js';
import {
  TicketApiError,
  type UserLookupResponse,
} from '../types/api.js';

export type StaffAction = 'reply' | 'internal_note' | 'change_status' | 'close';

export type StaffResolution =
  | { ok: true; user: UserLookupResponse }
  | { ok: false; reason: string };

export function profileLinkHint(siteUrl: string): string {
  const origin = siteUrl.replace(/\/$/, '');
  const path = origin ? `${origin}/profile` : 'профиле на сайте';
  return `Привяжите Discord в ${path} (раздел «Связать Discord»).`;
}

export function messageForLookupError(
  error: unknown,
  siteUrl: string
): string {
  if (error instanceof TicketApiError) {
    if (error.code === 'discord_not_linked' || error.statusCode === 404) {
      return `Этот Discord не привязан к аккаунту сайта. ${profileLinkHint(siteUrl)}`;
    }
    if (error.code === 'discord_link_conflict') {
      return 'Этот Discord привязан к нескольким аккаунтам сайта. Обратитесь к администрации.';
    }
    if (error.code === 'user_deleted') {
      return 'Аккаунт на сайте удалён. Обратитесь к администрации.';
    }
    if (error.code === 'user_banned') {
      return 'Аккаунт на сайте заблокирован.';
    }
    if (error.code === 'invalid_discord_id') {
      return 'Некорректный Discord ID. Напишите ещё раз или обратитесь к администрации.';
    }
  }
  return 'Не удалось сопоставить Discord с аккаунтом сайта. Попробуйте позже.';
}

export function messageForForbidden(code?: string): string {
  switch (code) {
    case 'forbidden_internal_note':
      return 'Недостаточно прав для внутренних заметок (нужны `tickets.staff.internal_notes`).';
    case 'forbidden_status':
      return 'Недостаточно прав для смены статуса тикета.';
    case 'forbidden_attachment':
      return 'Недостаточно прав для загрузки вложения.';
    case 'forbidden_create':
      return 'Недостаточно прав для создания тикета.';
    case 'user_banned':
      return 'Аккаунт на сайте заблокирован.';
    case 'user_deleted':
      return 'Аккаунт на сайте удалён.';
    case 'forbidden_reply':
    default:
      return 'Недостаточно прав для ответа в тикете (нужна роль Хелпер+ / `tickets.staff.reply`).';
  }
}

export function evaluateStaffAction(
  user: UserLookupResponse,
  action: StaffAction
): StaffResolution {
  if (user.is_banned) {
    return { ok: false, reason: messageForForbidden('user_banned') };
  }

  const allowed =
    user.permissions.is_admin ||
    (action === 'reply' && user.permissions.can_reply) ||
    (action === 'internal_note' && user.permissions.can_internal_notes) ||
    (action === 'change_status' && user.permissions.can_change_status) ||
    (action === 'close' && (user.permissions.can_close || user.permissions.can_change_status));

  if (!allowed) {
    const code =
      action === 'internal_note'
        ? 'forbidden_internal_note'
        : action === 'change_status' || action === 'close'
          ? 'forbidden_status'
          : 'forbidden_reply';
    return { ok: false, reason: messageForForbidden(code) };
  }

  return { ok: true, user };
}

export async function resolveStaffFromDiscord(
  siteApi: SiteApiClient,
  discordUserId: string,
  action: StaffAction,
  siteUrl: string
): Promise<StaffResolution> {
  try {
    const user = await siteApi.getUserByDiscordId(discordUserId);
    return evaluateStaffAction(user, action);
  } catch (error) {
    return { ok: false, reason: messageForLookupError(error, siteUrl) };
  }
}
