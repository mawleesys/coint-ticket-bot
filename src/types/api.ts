/**
 * Типы Internal Ticket API сайта COINT.
 * Источник истины: docs/site-internal-api.md (обновлено 2026-10-06).
 */

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
  MessageCreated = 'message_created',
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

export type ApiErrorCode =
  | 'forbidden_reply'
  | 'forbidden_internal_note'
  | 'forbidden_status'
  | 'forbidden_attachment'
  | 'forbidden_attachment_download'
  | 'forbidden_create'
  | 'forbidden_assign'
  | 'forbidden_priority'
  | 'forbidden_category'
  | 'forbidden_view'
  | 'forbidden_stats'
  | 'user_banned'
  | 'user_deleted'
  | 'user_required'
  | 'external_message_conflict'
  | 'reference_conflict'
  | 'reference_not_found'
  | 'reference_ambiguous'
  | 'discord_link_conflict'
  | 'discord_not_linked'
  | 'invalid_discord_id';

export interface CreateTicketRequest {
  user_id: number;
  category_key: string;
  subject: string;
  body: string;
  server_id?: number;
  fields?: Record<string, unknown>;
  source?: TicketSource;
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
  author_type: TicketAuthorType;
  duplicate: boolean;
}

export interface UploadAttachmentRequest {
  user_id: number;
  message_id?: number;
  file: Buffer;
  filename: string;
  mimeType: string;
  source?: TicketSource;
}

export interface UploadAttachmentResponse {
  id: number;
}

export interface ChangeStatusRequest {
  status: TicketStatus;
  user_id?: number;
  source?: TicketSource;
}

export interface AddReferenceRequest {
  provider: string;
  external_type: string;
  external_id: string;
  metadata?: Record<string, unknown>;
  move?: boolean;
}

export interface AddReferenceResponse {
  id: number;
  provider: string;
  external_type: string;
  external_id: string;
}

export interface ClaimTicketRequest {
  user_id: number;
  source?: TicketSource;
}

export interface AssignTicketRequest {
  user_id: number;
  assignee_user_id?: number | null;
  team?: string | null;
  source?: TicketSource;
}

export interface UnassignTicketRequest {
  user_id: number;
  source?: TicketSource;
}

export interface SetPriorityRequest {
  user_id: number;
  priority: TicketPriority;
  source?: TicketSource;
}

export interface SetCategoryRequest {
  user_id: number;
  category_key: string;
  server_id?: number;
  source?: TicketSource;
}

export type TicketListQueue =
  | 'all'
  | 'inbox'
  | 'mine'
  | 'unassigned'
  | 'waiting-user'
  | 'waiting-staff'
  | 'overdue'
  | 'resolved';

export interface TicketListQuery {
  user_id: number;
  queue?: TicketListQueue;
  status?: TicketStatus;
  priority?: TicketPriority;
  source?: TicketSource;
  category?: string;
  team?: string;
  assignee_user_id?: number | 'none';
  server_id?: number;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  per_page?: number;
}

export interface TicketSummary {
  id: number;
  public_number: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  subject: string;
  category: string;
  category_name?: string;
  is_sensitive?: boolean;
  team?: string | null;
  owner_user_id?: number;
  assignee_user_id?: number | null;
  created_at?: string;
  first_response_at?: string | null;
  last_activity_at?: string;
  sla_due_at?: string | null;
  is_overdue?: boolean;
  references: ExternalReference[];
}

export interface TicketListMeta {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export interface TicketListResponse {
  data: TicketSummary[];
  meta: TicketListMeta;
}

export interface ByReferenceQuery {
  provider: string;
  external_id: string;
  external_type?: string;
  user_id?: number;
  include_internal?: boolean;
}

export interface SiteStatsQuery {
  from?: string;
  to?: string;
  user_id?: number;
}

export interface SiteStatsDuration {
  count: number;
  avg_seconds: number;
  median_seconds: number;
}

export interface SiteStatsSla {
  measured: number;
  met: number;
  breached: number;
  pending: number;
  met_rate: number;
  targets_minutes: Record<string, number>;
}

export interface SiteStatsStaff {
  user_id: number;
  name: string;
  role: string;
  replies: number;
  tickets_replied: number;
  replies_by_source: Record<string, number>;
  first_responses: number;
  first_response: SiteStatsDuration;
  resolved: number;
  closed: number;
}

export interface SiteStatsResponse {
  period: { from: string; to: string };
  tickets: {
    created: number;
    by_status: Record<string, number>;
    by_priority: Record<string, number>;
    by_source: Record<string, number>;
    by_category: Record<string, number>;
    without_staff_reply: number;
  };
  first_response: SiteStatsDuration;
  resolution: SiteStatsDuration;
  sla: SiteStatsSla;
  by_channel: {
    replies: Record<string, number>;
    first_responses: Record<string, number>;
  };
  by_staff: SiteStatsStaff[];
}

export interface TicketAttachment {
  id: number;
  message_id: number | null;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface TicketMessage {
  id: number;
  body: string;
  is_internal: boolean;
  author_type: TicketAuthorType;
  author_user_id?: number | null;
  source: TicketSource;
  external_message_id: string | null;
  created_at?: string;
}

export interface ExternalReference {
  provider: string;
  external_type: string;
  external_id: string;
}

export interface Ticket {
  id?: number;
  public_number: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  subject: string;
  category: string;
  category_name?: string;
  is_sensitive?: boolean;
  team?: string | null;
  owner_user_id?: number;
  assignee_user_id?: number | null;
  server_id?: number | null;
  merged_into?: string | null;
  created_at?: string;
  updated_at?: string;
  first_response_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  last_activity_at?: string;
  sla_due_at?: string | null;
  is_overdue?: boolean;
  messages: TicketMessage[];
  attachments?: TicketAttachment[];
  references: ExternalReference[];
}

export type CreateTicketResponse = Ticket;
export type GetTicketResponse = Ticket;

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
  description?: string;
  is_active?: boolean;
  is_sensitive: boolean;
  requires_server: boolean;
  default_priority: TicketPriority;
  team?: string | null;
  form_schema?: CategoryFormSchema;
}

export interface CategoriesResponse {
  data: Category[];
}

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

export interface StaffPermissions {
  can_view_tickets: boolean;
  can_view_all_tickets: boolean;
  can_reply: boolean;
  can_internal_notes: boolean;
  can_view_sensitive: boolean;
  can_change_status: boolean;
  can_change_priority: boolean;
  can_assign: boolean;
  can_close: boolean;
  can_create_tickets: boolean;
  can_reply_own: boolean;
  is_admin: boolean;
}

export interface UserLookupResponse {
  user_id: number;
  name: string;
  discord_name: string;
  role: string;
  role_id: number;
  role_power: number;
  is_banned: boolean;
  permissions: StaffPermissions;
}

export interface OutboxEvent {
  id: number;
  ticket_id: number;
  ticket_number: string;
  category: string;
  is_sensitive: boolean;
  event_type: string;
  source: string;
  actor_user_id: number | null;
  message_id: number | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface EventsFeedResponse {
  data: OutboxEvent[];
  next_after_id: number;
  has_more: boolean;
}

export class TicketApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public errors?: Record<string, string[]>,
    public ticketNumber?: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TicketApiError';
  }
}

export const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
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

export const MIN_STAFF_ROLE_POWER = 5;
