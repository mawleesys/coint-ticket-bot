import {
  evaluateStaffAction,
  messageForForbidden,
  messageForLookupError,
} from '../src/sync/staff-resolver.js';
import { TicketApiError, type UserLookupResponse } from '../src/types/api.js';

const defaultPermissions: UserLookupResponse['permissions'] = {
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
};

function user(overrides: Partial<UserLookupResponse> = {}): UserLookupResponse {
  return {
    user_id: 45,
    name: 'Helper',
    discord_name: 'helper',
    role: 'Хелпер',
    role_id: 13,
    role_power: 5,
    is_banned: false,
    ...overrides,
    permissions: {
      ...defaultPermissions,
      ...overrides.permissions,
    },
  };
}

describe('staff resolver', () => {
  it('accepts staff with reply permission', () => {
    const result = evaluateStaffAction(user(), 'reply');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.user_id).toBe(45);
    }
  });

  it('rejects banned and unprivileged users with a helpful reason', () => {
    expect(evaluateStaffAction(user({ is_banned: true }), 'reply').ok).toBe(false);
    const player = evaluateStaffAction(
      user({ permissions: { ...user().permissions, can_reply: false } }),
      'reply'
    );
    expect(player.ok).toBe(false);
    if (!player.ok) {
      expect(player.reason).toMatch(/Хелпер|tickets.staff.reply/);
    }
  });

  it('explains unlinked and conflict lookup errors', () => {
    expect(
      messageForLookupError(
        new TicketApiError('no', 404, 'discord_not_linked'),
        'https://example.com'
      )
    ).toMatch(/Привяжите Discord/);

    expect(
      messageForLookupError(
        new TicketApiError('conflict', 409, 'discord_link_conflict'),
        'https://example.com'
      )
    ).toMatch(/нескольким/);
  });

  it('maps forbidden_* codes', () => {
    expect(messageForForbidden('forbidden_internal_note')).toMatch(/внутренн/);
    expect(messageForForbidden('user_banned')).toMatch(/заблокирован/);
    expect(messageForForbidden('forbidden_assign')).toMatch(/назнач/);
    expect(messageForForbidden('forbidden_priority')).toMatch(/приоритет/);
    expect(messageForForbidden('forbidden_category')).toMatch(/категор/);
    expect(messageForForbidden('forbidden_view')).toMatch(/видеть/);
    expect(messageForForbidden('forbidden_attachment_download')).toMatch(
      /скачиван/
    );
    expect(messageForForbidden('user_required')).toMatch(/вложен/);
  });

  it('checks assign and priority permissions', () => {
    expect(evaluateStaffAction(user(), 'assign').ok).toBe(true);
    expect(evaluateStaffAction(user(), 'change_priority').ok).toBe(true);
    const noAssign = evaluateStaffAction(
      user({ permissions: { ...user().permissions, can_assign: false } }),
      'assign'
    );
    expect(noAssign.ok).toBe(false);
    if (!noAssign.ok) {
      expect(noAssign.reason).toMatch(/назнач|assign/);
    }
  });
});
