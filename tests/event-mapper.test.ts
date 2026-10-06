import {
  TicketAuthorType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type Ticket,
  type TicketMessage,
} from '../src/types/api.js';
import {
  formatThreadTitle,
  mapCreatedTicketToThreadDraft,
  mapSiteMessageToDiscordDraft,
  mapStatusChangeToTagsDraft,
  parseStaffThreadMessage,
} from '../src/discord/event-mapper.js';

const baseTicket: Ticket = {
  public_number: 'COINT-123',
  status: TicketStatus.Open,
  priority: TicketPriority.High,
  source: TicketSource.Website,
  subject: 'Лагает при входе',
  category: 'technical',
  messages: [
    {
      id: 1,
      body: 'Первое сообщение игрока',
      is_internal: false,
      author_type: TicketAuthorType.User,
      source: TicketSource.Website,
      external_message_id: null,
    },
  ],
  references: [],
};

describe('event-to-Discord mapping', () => {
  it('formats thread titles as COINT-N · subject', () => {
    expect(formatThreadTitle('COINT-123', 'Тема')).toBe('COINT-123 · Тема');
  });

  it('truncates long subjects for the Discord 100-char title limit', () => {
    const title = formatThreadTitle('COINT-1', 'я'.repeat(200));
    expect(title.startsWith('COINT-1 · ')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it('maps a created ticket to a public thread draft with tags', () => {
    const draft = mapCreatedTicketToThreadDraft(baseTicket);
    expect(draft.kind).toBe('create_thread');
    expect(draft.channel).toBe('public');
    expect(draft.title).toBe('COINT-123 · Лагает при входе');
    expect(draft.content).toBe('Первое сообщение игрока');
    expect(draft.tags.status).toContain('Открыт');
    expect(draft.tags.priority).toContain('Высокий');
  });

  it('maps staff/user/internal messages to Discord copy', () => {
    const user: TicketMessage = {
      id: 2,
      body: 'Ещё скрин',
      is_internal: false,
      author_type: TicketAuthorType.User,
      source: TicketSource.Website,
      external_message_id: null,
    };
    const staff: TicketMessage = {
      ...user,
      id: 3,
      body: 'Принято',
      author_type: TicketAuthorType.Staff,
    };
    const note: TicketMessage = {
      ...user,
      id: 4,
      body: 'Проверил логи',
      is_internal: true,
      author_type: TicketAuthorType.Staff,
    };

    expect(mapSiteMessageToDiscordDraft('COINT-123', 'technical', user).content).toContain(
      'Игрок'
    );
    expect(mapSiteMessageToDiscordDraft('COINT-123', 'technical', staff).content).toContain(
      'Персонал'
    );
    expect(
      mapSiteMessageToDiscordDraft('COINT-123', 'technical', note).isInternal
    ).toBe(true);
  });

  it('marks Discord-sourced site messages as loop skips', () => {
    const message: TicketMessage = {
      id: 9,
      body: 'from discord',
      is_internal: false,
      author_type: TicketAuthorType.Staff,
      source: TicketSource.Discord,
      external_message_id: '111',
    };
    const draft = mapSiteMessageToDiscordDraft('COINT-123', 'technical', message);
    expect(draft.skipBecauseLoop).toBe(true);
    expect(draft.content).toBeUndefined();
  });

  it('maps status changes to forum tag names', () => {
    const draft = mapStatusChangeToTagsDraft(
      'COINT-123',
      'technical',
      TicketStatus.Resolved,
      TicketPriority.Urgent
    );
    expect(draft.kind).toBe('update_tags');
    expect(draft.tags.status).toContain('Решен');
    expect(draft.tags.priority).toContain('Срочный');
  });

  it('parses !note as an internal note body', () => {
    expect(parseStaffThreadMessage('!note секрет')).toEqual({
      isInternal: true,
      body: 'секрет',
    });
    expect(parseStaffThreadMessage('обычный ответ')).toEqual({
      isInternal: false,
      body: 'обычный ответ',
    });
  });
});
