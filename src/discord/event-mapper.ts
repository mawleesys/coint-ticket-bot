/**
 * Чистое отображение событий тикета → черновики сообщений Discord.
 * Не зависит от discord.js Client — удобно тестировать.
 */

import {
  TicketAuthorType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type Ticket,
  type TicketMessage,
} from '../types/api.js';
import {
  INTERNAL_NOTE_PREFIX,
  PRIORITY_TAG_NAMES,
  STATUS_TAG_NAMES,
} from '../types/discord.js';
import { isConfidentialCategory } from '../routing/confidentiality.js';

export type MirrorKind = 'create_thread' | 'post_message' | 'update_tags';

export interface DiscordMirrorDraft {
  kind: MirrorKind;
  ticketNumber: string;
  channel: 'public' | 'confidential';
  title?: string;
  content?: string;
  isInternal?: boolean;
  tags: {
    status?: string;
    priority?: string;
    category?: string;
  };
  skipBecauseLoop?: boolean;
}

const THREAD_SUBJECT_LIMIT = 80;

export function formatThreadTitle(ticketNumber: string, subject: string): string {
  const truncated =
    subject.length > THREAD_SUBJECT_LIMIT
      ? `${subject.slice(0, THREAD_SUBJECT_LIMIT - 3)}...`
      : subject;
  return `${ticketNumber} · ${truncated}`;
}

export function redactConfidentialText(text: string, categoryKey: string): string {
  if (isConfidentialCategory(categoryKey)) {
    return 'Текст скрыт: чувствительная категория';
  }
  return text;
}

export function mapCreatedTicketToThreadDraft(ticket: Ticket): DiscordMirrorDraft {
  const firstPublic = ticket.messages.find((message) => !message.is_internal);
  const confidential = isConfidentialCategory(ticket.category);

  return {
    kind: 'create_thread',
    ticketNumber: ticket.public_number,
    channel: confidential ? 'confidential' : 'public',
    title: formatThreadTitle(ticket.public_number, ticket.subject),
    content: firstPublic?.body ?? '',
    tags: {
      status: STATUS_TAG_NAMES[ticket.status],
      priority: PRIORITY_TAG_NAMES[ticket.priority],
      category: ticket.category,
    },
  };
}

export function mapSiteMessageToDiscordDraft(
  ticketNumber: string,
  categoryKey: string,
  message: TicketMessage
): DiscordMirrorDraft {
  const confidential = isConfidentialCategory(categoryKey);
  const skipBecauseLoop = message.source === TicketSource.Discord

  let prefix = '';
  if (message.is_internal) {
    prefix = '🔒 **[Внутренняя заметка]**\n';
  } else if (message.author_type === TicketAuthorType.User) {
    prefix = '💬 **Игрок:**\n';
  } else if (message.author_type === TicketAuthorType.Staff) {
    prefix = '👨‍💼 **Персонал:**\n';
  }

  return {
    kind: 'post_message',
    ticketNumber,
    channel: confidential ? 'confidential' : 'public',
    content: skipBecauseLoop ? undefined : `${prefix}${message.body}`,
    isInternal: message.is_internal,
    tags: {},
    skipBecauseLoop,
  };
}

export function mapStatusChangeToTagsDraft(
  ticketNumber: string,
  categoryKey: string,
  status: TicketStatus,
  priority: TicketPriority
): DiscordMirrorDraft {
  return {
    kind: 'update_tags',
    ticketNumber,
    channel: isConfidentialCategory(categoryKey) ? 'confidential' : 'public',
    tags: {
      status: STATUS_TAG_NAMES[status],
      priority: PRIORITY_TAG_NAMES[priority],
    },
  };
}

export function parseStaffThreadMessage(content: string): {
  isInternal: boolean;
  body: string;
} {
  const trimmed = content.trim();
  if (trimmed.toLowerCase().startsWith(INTERNAL_NOTE_PREFIX)) {
    return {
      isInternal: true,
      body: trimmed.slice(INTERNAL_NOTE_PREFIX.length).trim(),
    };
  }
  return { isInternal: false, body: trimmed };
}
