/**
 * Кнопки карточки тикета → действие Internal API.
 */

import { TicketPriority, TicketStatus } from '../types/api.js';
import { TicketButtonId } from '../types/discord.js';

export type TicketCardAction =
  | { kind: 'claim' }
  | { kind: 'status'; status: TicketStatus }
  | { kind: 'priority'; priority: TicketPriority }
  | { kind: 'unknown' };

const BUTTON_ACTIONS: Record<string, TicketCardAction> = {
  [TicketButtonId.Take]: { kind: 'claim' },
  [TicketButtonId.Resolve]: { kind: 'status', status: TicketStatus.Resolved },
  [TicketButtonId.Close]: { kind: 'status', status: TicketStatus.Closed },
  [TicketButtonId.Reopen]: { kind: 'status', status: TicketStatus.Open },
  [TicketButtonId.PriorityLow]: {
    kind: 'priority',
    priority: TicketPriority.Low,
  },
  [TicketButtonId.PriorityNormal]: {
    kind: 'priority',
    priority: TicketPriority.Normal,
  },
  [TicketButtonId.PriorityHigh]: {
    kind: 'priority',
    priority: TicketPriority.High,
  },
  [TicketButtonId.PriorityUrgent]: {
    kind: 'priority',
    priority: TicketPriority.Urgent,
  },
};

export function actionFromTicketButton(buttonId: string): TicketCardAction {
  return BUTTON_ACTIONS[buttonId] ?? { kind: 'unknown' };
}
