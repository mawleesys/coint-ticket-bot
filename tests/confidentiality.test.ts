import {
  assertConfidentialRoute,
  isConfidentialCategory,
  routeTicketToForum,
} from '../src/routing/confidentiality.js';
import { mapCreatedTicketToThreadDraft } from '../src/discord/event-mapper.js';
import {
  TicketAuthorType,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type Ticket,
} from '../src/types/api.js';

const channels = {
  publicForumChannelId: 'public-forum',
  confidentialForumChannelId: 'confidential-forum',
};

function ticket(category: string): Ticket {
  return {
    public_number: 'COINT-9',
    status: TicketStatus.Open,
    priority: TicketPriority.Normal,
    source: TicketSource.Website,
    subject: 'Тема',
    category,
    messages: [
      {
        id: 1,
        body: 'текст жалобы',
        is_internal: false,
        author_type: TicketAuthorType.User,
        source: TicketSource.Website,
        external_message_id: null,
      },
    ],
    references: [],
  };
}

describe('confidentiality routing', () => {
  it('treats staff_complaint as sensitive', () => {
    expect(isConfidentialCategory('staff_complaint')).toBe(true);
    expect(isConfidentialCategory('technical')).toBe(false);
    expect(isConfidentialCategory('appeal')).toBe(false);
  });

  it('routes complaints only to the restricted forum', () => {
    const route = routeTicketToForum('staff_complaint', channels);
    expect(route.isConfidential).toBe(true);
    expect(route.channelId).toBe('confidential-forum');
    expect(route.channelId).not.toBe('public-forum');
  });

  it('routes ordinary categories to the public forum', () => {
    const route = routeTicketToForum('technical', channels);
    expect(route.isConfidential).toBe(false);
    expect(route.channelId).toBe('public-forum');
  });

  it('refuses to mirror a confidential ticket into the public forum', () => {
    expect(() =>
      assertConfidentialRoute('staff_complaint', 'public-forum', channels)
    ).toThrow(/never|public forum|Refusing/i);
  });

  it('creates confidential thread drafts that never target the public channel', () => {
    const draft = mapCreatedTicketToThreadDraft(ticket('staff_complaint'));
    expect(draft.channel).toBe('confidential');
    expect(draft.channel).not.toBe('public');
  });
});
