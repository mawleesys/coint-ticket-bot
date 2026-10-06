/**
 * Типы данных для Discord интеграции
 */

import {
  TicketStatus,
  TicketPriority,
  TicketAuthorType,
} from './api.js';

// ====================================
// Discord Ticket Mapping
// ====================================

/**
 * Маппинг тикета на Discord тред
 */
export interface TicketThreadMapping {
  ticketNumber: string;
  threadId: string;
  channelId: string;
  starterMessageId?: string;
  isConfidential: boolean;
  lastSyncedMessageId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Информация о Discord пользователе, связанном с тикетом
 */
export interface DiscordUserInfo {
  discordUserId: string;
  siteUserId: number;
  username: string;
  canReply: boolean;
  canInternalNote: boolean;
  isStaff: boolean;
}

// ====================================
// Discord Message Formats
// ====================================

/**
 * Формат сообщения для создания треда
 */
export interface TicketThreadCreateData {
  ticketNumber: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  authorName: string;
  firstMessage: string;
  isConfidential: boolean;
}

/**
 * Формат сообщения о новом ответе в треде
 */
export interface TicketReplyData {
  messageId: number;
  body: string;
  authorType: TicketAuthorType;
  authorName?: string;
  isInternal: boolean;
  source: string;
  attachmentIds?: number[];
}

/**
 * Данные для обновления тегов треда
 */
export interface ThreadTagsUpdate {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
}

// ====================================
// Discord Tag Mapping
// ====================================

/**
 * Маппинг статусов на имена тегов Discord
 */
export const STATUS_TAG_NAMES: Record<TicketStatus, string> = {
  [TicketStatus.Open]: '📋 Открыт',
  [TicketStatus.InProgress]: '🔧 В работе',
  [TicketStatus.WaitingForStaff]: '⏳ Ожидает персонал',
  [TicketStatus.WaitingForUser]: '💬 Ожидает игрока',
  [TicketStatus.Resolved]: '✅ Решен',
  [TicketStatus.Closed]: '🔒 Закрыт',
};

/**
 * Маппинг приоритетов на имена тегов Discord
 */
export const PRIORITY_TAG_NAMES: Record<TicketPriority, string> = {
  [TicketPriority.Low]: '🟢 Низкий',
  [TicketPriority.Normal]: '🟡 Обычный',
  [TicketPriority.High]: '🟠 Высокий',
  [TicketPriority.Urgent]: '🔴 Срочный',
};

/**
 * Цвета embed'ов для разных статусов
 */
export const STATUS_COLORS: Record<TicketStatus, number> = {
  [TicketStatus.Open]: 0x3498db, // blue
  [TicketStatus.InProgress]: 0x9b59b6, // purple
  [TicketStatus.WaitingForStaff]: 0xe67e22, // orange
  [TicketStatus.WaitingForUser]: 0xf1c40f, // yellow
  [TicketStatus.Resolved]: 0x2ecc71, // green
  [TicketStatus.Closed]: 0x95a5a6, // gray
};

/**
 * Цвета embed'ов для приоритетов
 */
export const PRIORITY_COLORS: Record<TicketPriority, number> = {
  [TicketPriority.Low]: 0x95a5a6, // gray
  [TicketPriority.Normal]: 0x3498db, // blue
  [TicketPriority.High]: 0xe67e22, // orange
  [TicketPriority.Urgent]: 0xe74c3c, // red
};

// ====================================
// Button IDs
// ====================================

/**
 * Custom IDs для кнопок управления тикетом
 */
export enum TicketButtonId {
  Take = 'ticket_take',
  Resolve = 'ticket_resolve',
  Close = 'ticket_close',
  Reopen = 'ticket_reopen',
  PriorityLow = 'ticket_priority_low',
  PriorityNormal = 'ticket_priority_normal',
  PriorityHigh = 'ticket_priority_high',
  PriorityUrgent = 'ticket_priority_urgent',
}

/**
 * Префикс для команды создания внутренней заметки
 */
export const INTERNAL_NOTE_PREFIX = '!note';

// ====================================
// Discord Event Types
// ====================================

/**
 * Тип события от Discord, требующего синхронизации с сайтом
 */
export enum DiscordEventType {
  MessageCreate = 'message_create',
  MessageUpdate = 'message_update',
  MessageDelete = 'message_delete',
  ButtonClick = 'button_click',
  ThreadArchive = 'thread_archive',
  ThreadUnarchive = 'thread_unarchive',
}

/**
 * Событие от Discord для обработки
 */
export interface DiscordEvent {
  type: DiscordEventType;
  threadId: string;
  ticketNumber?: string;
  userId?: string;
  messageId?: string;
  content?: string;
  buttonId?: TicketButtonId;
  timestamp: Date;
}

// ====================================
// Stats & Metrics
// ====================================

/**
 * Статистика по тикету
 */
export interface TicketMetrics {
  ticketNumber: string;
  category: string;
  priority: TicketPriority;
  createdAt: Date;
  firstResponseAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  firstResponseTimeMinutes?: number;
  resolutionTimeMinutes?: number;
  staffRepliesCount: number;
  userRepliesCount: number;
  assignedStaffId?: number;
}

/**
 * Агрегированная статистика
 */
export interface AggregatedStats {
  period: {
    start: Date;
    end: Date;
  };
  totalTickets: number;
  resolvedTickets: number;
  closedTickets: number;
  avgFirstResponseTimeMinutes: number;
  medianFirstResponseTimeMinutes: number;
  avgResolutionTimeMinutes: number;
  medianResolutionTimeMinutes: number;
  slaCompliance: {
    low: number; // percentage
    normal: number;
    high: number;
    urgent: number;
  };
  byCategory: Record<string, number>;
  byPriority: Record<TicketPriority, number>;
  byStaff: Record<number, StaffStats>;
}

/**
 * Статистика по сотруднику
 */
export interface StaffStats {
  staffId: number;
  staffName: string;
  repliesCount: number;
  ticketsHandled: number;
  avgResponseTimeMinutes: number;
}
