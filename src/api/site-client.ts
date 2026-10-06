/**
 * Клиент Internal Ticket API. Строго по docs/site-internal-api.md.
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import {
  TicketApiError,
  TicketAuthorType,
  TicketSource,
  type AddMessageRequest,
  type AddMessageResponse,
  type AddReferenceRequest,
  type AddReferenceResponse,
  type CategoriesResponse,
  type Category,
  type ChangeStatusRequest,
  type CreateTicketRequest,
  type EventsFeedResponse,
  type Ticket,
  type UploadAttachmentRequest,
  type UploadAttachmentResponse,
  type UserLookupResponse,
} from '../types/api.js';

interface RequestOptions {
  body?: unknown;
  scope?: 'tickets' | 'users';
}

export class SiteApiClient {
  private readonly ticketsBase: string;
  private readonly usersBase: string;
  private readonly token: string;
  private readonly timeout: number;
  private readonly dryRun: boolean;
  private readonly debug: boolean;

  constructor(
    config: Config,
    private readonly logger: Logger
  ) {
    const origin = config.site.url.replace(/\/$/, '');
    this.ticketsBase = `${origin}/api/internal/tickets`;
    this.usersBase = `${origin}/api/internal/users`;
    this.token = config.site.apiToken;
    this.timeout = config.site.apiTimeout;
    this.dryRun = config.dryRun;
    this.debug = config.debugApiRequests;
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const base = options.scope === 'users' ? this.usersBase : this.ticketsBase;
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.dryRun) {
      this.logger.info({ method, url, body: options.body }, '[DRY RUN] Would send API request');
      return this.getMockResponse<T>(method, path);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      if (this.debug) {
        this.logger.debug({ method, url, body: options.body }, 'API request');
      }

      const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as T;
      if (this.debug) {
        this.logger.debug({ data, status: response.status }, 'API response');
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof TicketApiError) {
        throw error;
      }
      if ((error as Error).name === 'AbortError') {
        throw new TicketApiError('Request timeout', 408);
      }
      this.logger.error({ error, url }, 'API request failed');
      throw new TicketApiError('Network error', 500);
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: {
      message?: string;
      code?: string;
      errors?: Record<string, string[]>;
      ticket_number?: string;
      id?: number;
      user_ids?: number[];
    } = {};

    try {
      errorData = (await response.json()) as typeof errorData;
    } catch {
      throw new TicketApiError(response.statusText, response.status);
    }

    throw new TicketApiError(
      errorData.message || response.statusText,
      response.status,
      errorData.code,
      errorData.errors,
      errorData.ticket_number,
      {
        id: errorData.id,
        user_ids: errorData.user_ids,
      }
    );
  }

  private getMockResponse<T>(method: string, path: string): T {
    if (method === 'GET' && path.startsWith('/by-discord/')) {
      return {
        user_id: 45,
        name: 'Helper',
        discord_name: 'helper',
        role: 'Хелпер',
        role_id: 13,
        role_power: 5,
        is_banned: false,
        permissions: {
          can_view_tickets: true,
          can_view_all_tickets: true,
          can_reply: true,
          can_internal_notes: true,
          can_view_sensitive: false,
          can_change_status: true,
          can_change_priority: true,
          can_assign: true,
          can_close: true,
          can_create_tickets: true,
          can_reply_own: true,
          is_admin: false,
        },
      } as T;
    }

    if (method === 'GET' && path.startsWith('/events')) {
      return { data: [], next_after_id: 0, has_more: false } as T;
    }

    if (method === 'GET' && path.startsWith('/categories')) {
      return { data: [] } as T;
    }

    if (method === 'POST' && path.includes('/messages')) {
      return {
        id: 99999,
        is_internal: false,
        author_type: TicketAuthorType.Staff,
        duplicate: false,
      } as T;
    }

    if (method === 'POST' && path.includes('/references')) {
      return {
        id: 999,
        provider: 'discord',
        external_type: 'thread',
        external_id: '123456789',
      } as T;
    }

    return {
      public_number: 'COINT-9999',
      status: 'open',
      priority: 'normal',
      source: 'website',
      subject: 'Mock ticket',
      category: 'technical',
      is_sensitive: false,
      messages: [],
      attachments: [],
      references: [],
    } as T;
  }

  async createTicket(request: CreateTicketRequest): Promise<Ticket> {
    return await this.request<Ticket>('POST', '/', { body: request });
  }

  async getTicket(ticketNumber: string, includeInternal = false): Promise<Ticket> {
    const query = includeInternal ? '?include_internal=1' : '';
    return await this.request<Ticket>('GET', `/${ticketNumber}${query}`);
  }

  async addMessage(
    ticketNumber: string,
    request: AddMessageRequest
  ): Promise<AddMessageResponse> {
    return await this.request<AddMessageResponse>(
      'POST',
      `/${ticketNumber}/messages`,
      { body: request }
    );
  }

  async uploadAttachment(
    ticketNumber: string,
    request: UploadAttachmentRequest
  ): Promise<UploadAttachmentResponse> {
    if (this.dryRun) {
      this.logger.info(
        { ticketNumber, filename: request.filename },
        '[DRY RUN] Would upload attachment'
      );
      return { id: 99999 };
    }

    const formData = new FormData();
    formData.append('user_id', request.user_id.toString());
    if (request.message_id) {
      formData.append('message_id', request.message_id.toString());
    }
    formData.append(
      'source',
      request.source ?? TicketSource.Discord
    );
    formData.append(
      'file',
      new Blob([request.file], { type: request.mimeType }),
      request.filename
    );

    const response = await fetch(`${this.ticketsBase}/${ticketNumber}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
      body: formData,
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }
    return (await response.json()) as UploadAttachmentResponse;
  }

  async downloadAttachment(attachmentId: number): Promise<Buffer> {
    if (this.dryRun) {
      this.logger.info({ attachmentId }, '[DRY RUN] Would download attachment');
      return Buffer.from('mock attachment data');
    }

    const response = await fetch(
      `${this.ticketsBase}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${this.token}` } }
    );
    if (!response.ok) {
      throw new TicketApiError(
        `Failed to download attachment ${attachmentId}`,
        response.status
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async changeStatus(
    ticketNumber: string,
    request: ChangeStatusRequest
  ): Promise<Ticket> {
    return await this.request<Ticket>('POST', `/${ticketNumber}/status`, {
      body: request,
    });
  }

  async addReference(
    ticketNumber: string,
    request: AddReferenceRequest
  ): Promise<AddReferenceResponse> {
    return await this.request<AddReferenceResponse>(
      'POST',
      `/${ticketNumber}/references`,
      { body: request }
    );
  }

  async getEvents(afterId = 0, limit = 100): Promise<EventsFeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    return await this.request<EventsFeedResponse>(
      'GET',
      `/events?after_id=${afterId}&limit=${safeLimit}`
    );
  }

  async getCategories(): Promise<Category[]> {
    const response = await this.request<CategoriesResponse>('GET', '/categories');
    return response.data;
  }

  async getUserByDiscordId(discordId: string): Promise<UserLookupResponse> {
    return await this.request<UserLookupResponse>(
      'GET',
      `/by-discord/${discordId}`,
      { scope: 'users' }
    );
  }
}
