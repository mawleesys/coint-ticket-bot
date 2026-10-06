/**
 * Резолв Discord user → аккаунт сайта и проверка прав staff.
 */

import type { SiteApiClient } from '../api/site-client.js';
import {
  TicketApiError,
  type UserLookupResponse,
} from '../types/api.js';

export type StaffAction =
  | 'reply'
  | 'internal_note'
  | 'change_status'
  | 'close'
  | 'assign'
  | 'change_priority'
  | 'change_category'
  | 'view';

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
    case 'forbidden_attachment_download':
      return 'Недостаточно прав для скачивания вложения.';
    case 'forbidden_create':
      return 'Недостаточно прав для создания тикета.';
    case 'forbidden_assign':
      return 'Недостаточно прав, чтобы взять или назначить тикет (`tickets.staff.assign`).';
    case 'forbidden_priority':
      return 'Недостаточно прав для смены приоритета (`tickets.staff.change_priority`).';
    case 'forbidden_category':
      return 'Недостаточно прав для смены категории.';
    case 'forbidden_view':
      return 'Недостаточно прав, чтобы видеть этот тикет.';
    case 'forbidden_stats':
      return 'Недостаточно прав для статистики поддержки.';
    case 'user_required':
      return 'Для этого вложения нужен аккаунт сайта (internal/sensitive).';
    case 'reference_not_found':
      return 'Тикет для этого Discord-треда не найден на сайте.';
    case 'reference_ambiguous':
      return 'Несколько тикетов ссылаются на этот объект. Уточните тип ссылки.';
    case 'user_banned':
      return 'Аккаунт на сайте заблокирован.';
    case 'user_deleted':
      return 'Аккаунт на сайте удалён.';
    case 'forbidden_reply':
    default:
      return 'Недостаточно прав для ответа в тикете (нужна роль Хелпер+ / `tickets.staff.reply`).';
  }
}

function permissionForAction(
  user: UserLookupResponse,
  action: StaffAction
): boolean {
  const perms = user.permissions;
  if (perms.is_admin) {
    return true;
  }
  switch (action) {
    case 'reply':
      return perms.can_reply;
    case 'internal_note':
      return perms.can_internal_notes;
    case 'change_status':
      return perms.can_change_status;
    case 'close':
      return perms.can_close || perms.can_change_status;
    case 'assign':
      return perms.can_assign;
    case 'change_priority':
      return perms.can_change_priority;
    case 'change_category':
      return perms.can_change_status;
    case 'view':
      return perms.can_view_tickets || perms.can_view_all_tickets;
    default:
      return false;
  }
}

function forbiddenCodeForAction(action: StaffAction): string {
  switch (action) {
    case 'internal_note':
      return 'forbidden_internal_note';
    case 'change_status':
    case 'close':
      return 'forbidden_status';
    case 'assign':
      return 'forbidden_assign';
    case 'change_priority':
      return 'forbidden_priority';
    case 'change_category':
      return 'forbidden_category';
    case 'view':
      return 'forbidden_view';
    default:
      return 'forbidden_reply';
  }
}

export function evaluateStaffAction(
  user: UserLookupResponse,
  action: StaffAction
): StaffResolution {
  if (user.is_banned) {
    return { ok: false, reason: messageForForbidden('user_banned') };
  }

  if (!permissionForAction(user, action)) {
    return { ok: false, reason: messageForForbidden(forbiddenCodeForAction(action)) };
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
