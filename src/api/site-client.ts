/**
 * Клиент для Internal Ticket API сайта COINT
 * Строго следует спецификации из site-internal-api.md
 */

import type { Logger } from 'pino';
import type { Config } from '../config/index.js';
import {
  TicketApiError,
  type CreateTicketRequest,
  type CreateTicketResponse,
  type GetTicketResponse,
  type AddMessageRequest,
  type AddMessageResponse,
  type UploadAttachmentRequest,
  type UploadAttachmentResponse,
  type ChangeStatusRequest,
  type AddReferenceRequest,
  type AddReferenceResponse,
  type Ticket,
} from '../types/api.js';

export class SiteApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeout: number;
  private readonly dryRun: boolean;
  private readonly debug: boolean;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {
    this.baseUrl = `${config.site.url}/api/internal/tickets`;
    this.token = config.site.apiToken;
    this.timeout = config.site.apiTimeout;
    this.dryRun = config.dryRun;
    this.debug = config.debugApiRequests;
  }

  // ====================================
  // Core Request Method
  // ====================================

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      includeInternal?: boolean;
    } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.dryRun) {
      this.logger.info(
        {
          method,
          url,
          body: options.body,
          includeInternal: options.includeInternal,
        },
        '[DRY RUN] Would send API request'
      );
      // В dry-run возвращаем mock-данные
      return this.getMockResponse<T>(method, path);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      if (this.debug) {
        this.logger.debug({ method, url, body: options.body }, 'API request');
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as T;

      if (this.debug) {
        this.logger.debug({ data }, 'API response');
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof TicketApiError) {
        throw error;
      }

      if ((error as Error).name === 'AbortError') {
        this.logger.error({ url, timeout: this.timeout }, 'API request timeout');
        throw new TicketApiError('Request timeout', 408);
      }

      this.logger.error({ error, url }, 'API request failed');
      throw new TicketApiError('Network error', 500);
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: { message?: string; errors?: Record<string, string[]> } = {};

    try {
      errorData = (await response.json()) as typeof errorData;
    } catch {
      // Если не удалось распарсить JSON, используем statusText
      throw new TicketApiError(response.statusText, response.status);
    }

    const message = errorData.message || response.statusText;
    const errors = errorData.errors;

    this.logger.error(
      {
        status: response.status,
        message,
        errors,
        url: response.url,
      },
      'API error response'
    );

    throw new TicketApiError(message, response.status, errors);
  }

  private getMockResponse<T>(method: string, path: string): T {
    // Mock-ответы для dry-run режима
    if (method === 'POST' && path === '/') {
      return {
        public_number: 'COINT-9999',
        status: 'open',
        priority: 'normal',
        source: 'discord',
        subject: 'Mock ticket',
        category: 'technical',
        messages: [],
        references: [],
      } as T;
    }

    if (method === 'POST' && path.includes('/messages')) {
      return { id: 99999, is_internal: false } as T;
    }

    if (method === 'POST' && path.includes('/status')) {
      return {
        public_number: 'COINT-9999',
        status: 'resolved',
        messages: [],
        references: [],
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

    if (method === 'GET') {
      return {
        public_number: 'COINT-9999',
        status: 'open',
        priority: 'normal',
        source: 'website',
        subject: 'Mock ticket',
        category: 'technical',
        messages: [],
        references: [],
      } as T;
    }

    return {} as T;
  }

  // ====================================
  // API Endpoints
  // ====================================

  /**
   * POST / — создать тикет
   */
  async createTicket(
    request: CreateTicketRequest
  ): Promise<CreateTicketResponse> {
    this.logger.info(
      { user_id: request.user_id, category: request.category_key },
      'Creating ticket'
    );

    return await this.request<CreateTicketResponse>('POST', '/', {
      body: request,
    });
  }

  /**
   * GET /{ticket} — получить тикет
   */
  async getTicket(
    ticketNumber: string,
    includeInternal = false
  ): Promise<GetTicketResponse> {
    const path = `/${ticketNumber}${includeInternal ? '?include_internal=1' : ''}`;

    this.logger.debug(
      { ticketNumber, includeInternal },
      'Fetching ticket'
    );

    return await this.request<GetTicketResponse>('GET', path);
  }

  /**
   * POST /{ticket}/messages — добавить сообщение (ответ или внутреннюю заметку)
   */
  async addMessage(
    ticketNumber: string,
    request: AddMessageRequest
  ): Promise<AddMessageResponse> {
    this.logger.info(
      {
        ticketNumber,
        user_id: request.user_id,
        is_internal: request.is_internal,
        has_external_id: !!request.external_message_id,
      },
      'Adding message to ticket'
    );

    return await this.request<AddMessageResponse>(
      'POST',
      `/${ticketNumber}/messages`,
      { body: request }
    );
  }

  /**
   * POST /{ticket}/attachments — загрузить вложение
   * ВАЖНО: В текущей реализации загружается один файл за раз
   */
  async uploadAttachment(
    ticketNumber: string,
    request: UploadAttachmentRequest
  ): Promise<UploadAttachmentResponse> {
    if (this.dryRun) {
      this.logger.info(
        {
          ticketNumber,
          filename: request.filename,
          size: request.file.length,
        },
        '[DRY RUN] Would upload attachment'
      );
      return { id: 99999 };
    }

    this.logger.info(
      {
        ticketNumber,
        filename: request.filename,
        size: request.file.length,
        message_id: request.message_id,
      },
      'Uploading attachment'
    );

    const formData = new FormData();
    formData.append('user_id', request.user_id.toString());
    if (request.message_id) {
      formData.append('message_id', request.message_id.toString());
    }
    formData.append(
      'file',
      new Blob([request.file], { type: request.mimeType }),
      request.filename
    );

    const url = `${this.baseUrl}/${ticketNumber}/attachments`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as UploadAttachmentResponse;
  }

  /**
   * GET /attachments/{attachment} — скачать вложение
   */
  async downloadAttachment(attachmentId: number): Promise<Buffer> {
    const url = `${this.config.site.url}/api/internal/tickets/attachments/${attachmentId}`;

    if (this.dryRun) {
      this.logger.info(
        { attachmentId },
        '[DRY RUN] Would download attachment'
      );
      return Buffer.from('mock attachment data');
    }

    this.logger.debug({ attachmentId }, 'Downloading attachment');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new TicketApiError(
        `Failed to download attachment ${attachmentId}`,
        response.status
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * POST /{ticket}/status — изменить статус
   */
  async changeStatus(
    ticketNumber: string,
    request: ChangeStatusRequest
  ): Promise<Ticket> {
    this.logger.info(
      {
        ticketNumber,
        status: request.status,
        user_id: request.user_id,
      },
      'Changing ticket status'
    );

    return await this.request<Ticket>('POST', `/${ticketNumber}/status`, {
      body: request,
    });
  }

  /**
   * POST /{ticket}/references — связать внешний объект
   */
  async addReference(
    ticketNumber: string,
    request: AddReferenceRequest
  ): Promise<AddReferenceResponse> {
    this.logger.info(
      {
        ticketNumber,
        provider: request.provider,
        external_type: request.external_type,
        external_id: request.external_id,
      },
      'Adding external reference'
    );

    return await this.request<AddReferenceResponse>(
      'POST',
      `/${ticketNumber}/references`,
      { body: request }
    );
  }

  // ====================================
  // Planned Endpoints (gaps в спецификации)
  // ====================================

  /**
   * TODO / planned: GET /api/internal/users/by-discord/{discord_id}
   * Gap #6. Включается флагом FEATURE_DISCORD_USER_LOOKUP после реализации на сайте.
   */
  getUserByDiscordId(_discordId: string): never {
    throw new Error(
      this.plannedEndpointMessage(
        'FEATURE_DISCORD_USER_LOOKUP',
        this.config.features.discordUserLookup,
        'gap #6: GET /api/internal/users/by-discord/{id} → user_id, name, role, staff permission flags'
      )
    );
  }

  /**
   * TODO / planned: GET /api/internal/tickets/events?after_id=N
   * Gap #4. Включается флагом FEATURE_SITE_EVENT_FEED.
   */
  getEventsSince(_afterId: number): never {
    throw new Error(
      this.plannedEndpointMessage(
        'FEATURE_SITE_EVENT_FEED',
        this.config.features.siteEventFeed,
        'gap #4: GET /events?after_id=N (id, ticket_number, event_type, message_id, source, created_at)'
      )
    );
  }

  /**
   * TODO / planned: GET /api/internal/tickets/categories
   * Gap #7. Включается флагом FEATURE_CATEGORIES_ENDPOINT.
   */
  getCategories(): never {
    throw new Error(
      this.plannedEndpointMessage(
        'FEATURE_CATEGORIES_ENDPOINT',
        this.config.features.categoriesEndpoint,
        'gap #7: GET /categories (key, name, is_sensitive, requires_server, default_priority, form_schema)'
      )
    );
  }

  private plannedEndpointMessage(
    flag: string,
    enabled: boolean,
    spec: string
  ): string {
    const flagState = enabled ? `${flag}=true, но клиент ещё не реализован` : `${flag}=false`;
    return `TODO/planned endpoint (${flagState}): ${spec}`;
  }
}
