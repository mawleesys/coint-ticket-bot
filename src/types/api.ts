/**
 * Типы данных для Internal Ticket API сайта COINT
 * Основано на спецификации site-internal-api.md
 */

// ====================================
// Enums
// ====================================

export enum TicketStatus {
  Open = 'open',
  InProgress = 'in_progress',
  WaitingForStaff = 'waiting_for_staff',
  WaitingForUser = 'waiting_for_user',
  Resolved = 'resolved',
  Closed = 'closed',
}

export enum TicketPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high',
  Urgent = 'urgent',
}

export enum TicketSource {
  Website = 'website',
  Discord = 'discord',
  System = 'system',
}

export enum TicketAuthorType {
  User = 'user',
  Staff = 'staff',
  System = 'system',
}

export enum TicketEventType {
  Created = 'created',
  Assigned = 'assigned',
  Unassigned = 'unassigned',
  TeamChanged = 'team_changed',
  StatusChanged = 'status_changed',
  Resolved = 'resolved',
  Closed = 'closed',
  Reopened = 'reopened',
  PriorityChanged = 'priority_changed',
  CategoryChanged = 'category_changed',
  InternalNoteAdded = 'internal_note_added',
  AttachmentAdded = 'attachment_added',
  Merged = 'merged',
}

// ====================================
// API Request/Response Types
// ====================================

export interface CreateTicketRequest {
  user_id: number;
  category_key: string;
  subject: string;
  body: string;
  server_id?: number;
  fields?: Record<string, unknown>;
  source?: TicketSource;
}

export interface CreateTicketResponse {
  public_number: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  subject: string;
  category: string;
  messages: TicketMessage[];
  references: ExternalReference[];
}

export interface GetTicketResponse {
  public_number: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  subject: string;
  category: string;
  messages: TicketMessage[];
  references: ExternalReference[];
}

export interface AddMessageRequest {
  user_id: number;
  body: string;
  is_internal?: boolean;
  external_message_id?: string;
  source?: TicketSource;
}

export interface AddMessageResponse {
  id: number;
  is_internal: boolean;
}

export interface UploadAttachmentRequest {
  user_id: number;
  message_id?: number;
  file: Buffer;
  filename: string;
  mimeType: string;
}

export interface UploadAttachmentResponse {
  id: number;
}

export interface ChangeStatusRequest {
  status: TicketStatus;
  user_id?: number;
}

export interface AddReferenceRequest {
  provider: string;
  external_type: string;
  external_id: string;
  metadata?: Record<string, unknown>;
}

export interface AddReferenceResponse {
  id: number;
  provider: string;
  external_type: string;
  external_id: string;
}

// ====================================
// Data Models
// ====================================

export interface TicketMessage {
  id: number;
  body: string;
  is_internal: boolean;
  author_type: TicketAuthorType;
  source: TicketSource;
  external_message_id: string | null;
}

export interface ExternalReference {
  provider: string;
  external_type: string;
  external_id: string;
}

export interface Ticket {
  public_number: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  subject: string;
  category: string;
  messages: TicketMessage[];
  references: ExternalReference[];
}

// ====================================
// Category Types
// ====================================

export interface CategoryFormField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'datetime' | 'checkbox';
  required: boolean;
  label: string;
  options?: string[];
}

export interface CategoryFormSchema {
  fields: CategoryFormField[];
}

export interface Category {
  key: string;
  name: string;
  is_sensitive: boolean;
  requires_server: boolean;
  default_priority: TicketPriority;
  form_schema?: CategoryFormSchema;
}

// Известные категории из спецификации
export const KNOWN_CATEGORIES: Record<string, Partial<Category>> = {
  technical: { is_sensitive: false, requires_server: true },
  server_issue: { is_sensitive: false, requires_server: true },
  shop_payment: { is_sensitive: false, requires_server: false },
  lost_items: { is_sensitive: false, requires_server: true },
  player_report: { is_sensitive: false, requires_server: true },
  staff_complaint: { is_sensitive: true, requires_server: false },
  appeal: { is_sensitive: false, requires_server: false },
  website_bug: { is_sensitive: false, requires_server: false },
  other: { is_sensitive: false, requires_server: false },
} as const;

// ====================================
// API Error Types
// ====================================

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
  statusCode: number;
}

export class TicketApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'TicketApiError';
  }
}

// ====================================
// State Machine
// ====================================

/**
 * Разрешенные переходы между статусами
 * Основано на таблице переходов из спецификации
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<
  TicketStatus,
  TicketStatus[]
> = {
  [TicketStatus.Open]: [
    TicketStatus.InProgress,
    TicketStatus.WaitingForStaff,
    TicketStatus.WaitingForUser,
    TicketStatus.Resolved,
    TicketStatus.Closed,
  ],
  [TicketStatus.InProgress]: [
    TicketStatus.Open,
    TicketStatus.WaitingForStaff,
    TicketStatus.WaitingForUser,
    TicketStatus.Resolved,
    TicketStatus.Closed,
  ],
  [TicketStatus.WaitingForStaff]: [
    TicketStatus.InProgress,
    TicketStatus.WaitingForUser,
    TicketStatus.Resolved,
    TicketStatus.Closed,
  ],
  [TicketStatus.WaitingForUser]: [
    TicketStatus.InProgress,
    TicketStatus.WaitingForStaff,
    TicketStatus.Resolved,
    TicketStatus.Closed,
  ],
  [TicketStatus.Resolved]: [
    TicketStatus.Open,
    TicketStatus.WaitingForStaff,
    TicketStatus.WaitingForUser,
    TicketStatus.Closed,
  ],
  [TicketStatus.Closed]: [TicketStatus.Open],
};

export function isStatusTransitionAllowed(
  from: TicketStatus,
  to: TicketStatus
): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

// ====================================
// User & Permissions (для будущего расширения)
// ====================================

/**
 * ВАЖНО: Реализация отложена до появления endpoint'а на сайте
 * См. gaps #6 в спецификации
 */
export interface UserLookupResponse {
  user_id: number;
  name: string;
  role: string;
  permissions: {
    can_view_tickets: boolean;
    can_view_all_tickets: boolean;
    can_reply: boolean;
    can_internal_notes: boolean;
    can_view_sensitive: boolean;
    is_admin: boolean;
  };
}

/**
 * Минимальная роль для работы с тикетами (Хелпер, power=5)
 */
export const MIN_STAFF_ROLE_POWER = 5;

// ====================================
// Webhook Event (для будущего расширения)
// ====================================

/**
 * ВАЖНО: Реализация отложена до появления outbox/feed endpoint'а
 * См. gaps #4 в спецификации
 */
export interface OutboxEvent {
  id: number;
  ticket_number: string;
  event_type: TicketEventType;
  message_id?: number;
  source: TicketSource;
  created_at: string;
}
