import type { Timestamp } from './timestamp';

/**
 * Registration state.
 *
 * - `confirmed` — holds a spot
 * - `held` — paid reservation awaiting the Stripe webhook
 * - `pending` — on the waitlist
 * - `cancelled` — cancelled by the guest or the organizer
 * - `expired` — a `held` reservation whose payment never landed
 */
export type GuestStatus =
  'confirmed' | 'held' | 'pending' | 'cancelled' | 'expired';

/**
 * Guest document: `events/{eventId}/guests/{guestId}`.
 *
 * `guestId` is the normalized email, which makes double-registration impossible
 * without a query and turns cancel/lookup into an O(1) `get()`. Derive it only
 * via `normalizeEmail()` from `@upskills/validation`.
 */
export interface Guest {
  /** Normalized email (trimmed + lowercased) — the doc id. */
  guestId: string;
  eventId: string;
  orgId: string;
  email: string;
  name: string;
  status: GuestStatus;
  registeredAt: Timestamp;
  confirmedAt?: Timestamp;
  cancelledAt?: Timestamp;
  checkedInAt?: Timestamp;
  /** uid of the staff member who checked this guest in. */
  checkedInBy?: string;
  /** 1-based position while `status` is `'pending'`. */
  waitlistPosition?: number;
  /** Random token embedded in emails; required to self-cancel. */
  cancelToken: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  /** Amount actually paid, in **minor units** (cents). */
  amountPaid?: number;
  /** Only meaningful while `status` is `'held'`. */
  holdExpiresAt?: Timestamp;
}
