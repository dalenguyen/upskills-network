import type { Guest, GuestStatus, Timestamp } from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';
import { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';
import { eventRef, guestRef } from './collections';
import {
  EventIsExternalError,
  EventNotFoundError,
  EventNotRegisterableError,
  PaymentRequiredError,
  applyCounters,
  guestFromSnapshot,
  isActive,
  newCancelToken,
  runIdempotentTransaction,
} from './transactions';

/**
 * Whether the spot is taken outright or reserved pending payment.
 *
 * - `confirm` — free events: the guest holds the seat immediately.
 * - `hold` — paid events: the seat is reserved while Stripe Checkout runs, and
 *   is released by `releaseHold` (or the expiry sweep) if payment never lands.
 */
export type ReserveMode = 'confirm' | 'hold';

/** What the guest ended up with. */
export type ReserveOutcome = 'confirmed' | 'held' | 'waitlisted';

/** The caller-supplied half of a guest document. */
export interface GuestDraft {
  /** Raw user input; normalized here, so callers never pre-process it. */
  email: string;
  name: string;
  /** Generated when omitted — pass one only to reuse a token across a retry. */
  cancelToken?: string;
  /** `hold` mode: when the reservation lapses. Match Stripe's `expires_at`. */
  holdExpiresAt?: Timestamp;
  /** `hold` mode: the Checkout Session this reservation is waiting on. */
  stripeSessionId?: string;
}

export interface ReserveSpotResult {
  outcome: ReserveOutcome;
  /**
   * `true` when the guest already occupied a place and nothing was written.
   *
   * This is the "already registered" answer, and it is deliberately not an
   * error: a guest who submits the form twice, or reloads the confirmation
   * page, must not get a 500 or a second document. Callers use it to skip the
   * welcome email they already sent.
   */
  alreadyRegistered: boolean;
  /** The guest as it now stands — the existing one when idempotent. */
  guest: Guest;
}

/** The outcome each place-holding status reports back as. */
const OUTCOME_BY_STATUS: Partial<Record<GuestStatus, ReserveOutcome>> = {
  confirmed: 'confirmed',
  held: 'held',
  pending: 'waitlisted',
};

function outcomeFor(status: GuestStatus): ReserveOutcome {
  const outcome = OUTCOME_BY_STATUS[status];
  if (!outcome) {
    // Unreachable: only the three place-holding statuses ever get here.
    throw new Error(`Status "${status}" is not a reservation outcome.`);
  }

  return outcome;
}

/**
 * Reserve a place on an event: the one function every registration path goes
 * through, and the only place capacity is decided.
 *
 * ## Why a transaction and not an insert
 *
 * The seat count lives on the event document, and the check against it and the
 * write that consumes it happen in the same transaction, re-reading the event
 * inside. Reading the count first and writing after — in two round trips, or
 * from a `count()` over the guests subcollection — is a lost update: two
 * simultaneous registrations both see the last seat and both take it. That race
 * is what `reserve-spot.concurrency.spec.ts` exists to catch.
 *
 * ## Outcome
 *
 * - Already `confirmed`, `held` or `pending` → that same outcome, untouched,
 *   with `alreadyRegistered: true`.
 * - `maxGuests === 0` (unlimited), or `confirmedCount + heldCount < maxGuests`
 *   → `confirmed` / `held` per `mode`, and the matching counter goes up. Holds
 *   count against capacity: a seat mid-checkout is not a seat available.
 * - Otherwise → `pending` with a `waitlistPosition`, and `pendingCount` goes up.
 *
 * A guest who previously `cancelled` or whose hold `expired` registers afresh:
 * their place was already given back, so the document is rebuilt from scratch
 * and capacity is re-evaluated for them like anyone else.
 *
 * Only a `published` event accepts registrations, and in `confirm` mode only a
 * free one. Both are checked here rather than by the caller, against the event
 * read inside the transaction — see {@link EventNotRegisterableError} and
 * {@link PaymentRequiredError}.
 *
 * @throws EventNotFoundError if `eventId` names no event.
 * @throws EventNotRegisterableError if the event is a draft or cancelled.
 * @throws EventIsExternalError if the event is only *listed* here and takes its
 *   registrations on someone else's site.
 * @throws PaymentRequiredError in `confirm` mode if the event has a price.
 */
export async function reserveSpot(
  orgId: string,
  eventId: string,
  draft: GuestDraft,
  mode: ReserveMode,
): Promise<ReserveSpotResult> {
  const email = normalizeEmail(draft.email);
  const documents = {
    event: eventRef(orgId, eventId),
    guest: guestRef(orgId, eventId, email),
  };

  // Generated once, outside the transaction: a retried attempt must not mint a
  // second cancel token or shuffle the guest's place in the waitlist ordering.
  const registeredAt = FirestoreTimestamp.now();
  const cancelToken = draft.cancelToken ?? newCancelToken();

  return runIdempotentTransaction(async (transaction) => {
    // ── Reads first. Firestore forbids reading after a write, and the whole
    // correctness argument rests on these values being read *inside* here.
    const eventSnapshot = await transaction.get(documents.event);
    const guestSnapshot = await transaction.get(documents.guest);

    const event = eventSnapshot.data();
    if (!event) {
      throw new EventNotFoundError(eventId);
    }

    // Status before price, and both before anything else is decided. An
    // unpublished event must answer the same way whatever it costs — otherwise
    // a paid draft is distinguishable from a free one, and the fact that an
    // unannounced event exists leaks through the difference.
    if (event.status !== 'published') {
      throw new EventNotRegisterableError(eventId, event.status);
    }

    // After the status check, for the same leak argument: a *draft* listing
    // must answer 404 like any other draft, not reveal itself by pointing at
    // the source. Before the price check, because "register on Meetup" is the
    // more useful answer than "this costs money" when both are true.
    if (event.externalUrl) {
      throw new EventIsExternalError(eventId, event.externalUrl);
    }

    if (mode === 'confirm' && event.price > 0) {
      throw new PaymentRequiredError(eventId, event.price);
    }

    const existing = guestFromSnapshot(eventId, guestSnapshot);
    if (existing && isActive(existing.status)) {
      return {
        outcome: outcomeFor(existing.status),
        alreadyRegistered: true,
        guest: existing,
      };
    }

    const base = {
      guestId: email,
      eventId,
      // From the path the guest is being written to, not from the event body:
      // these are the same value, and the path is the one that cannot be stale.
      orgId,
      email,
      name: draft.name.trim(),
      registeredAt,
      cancelToken,
    } satisfies Omit<Guest, 'status'>;

    // `maxGuests: 0` is unlimited, so it never reaches the waitlist branch.
    const hasRoom =
      event.maxGuests === 0 ||
      event.confirmedCount + event.heldCount < event.maxGuests;

    const guest: Guest = hasRoom
      ? takenSeat(base, mode, registeredAt, draft)
      : {
          ...base,
          status: 'pending',
          // The waitlist is ordered by `registeredAt`; this is the position as
          // it stood at registration, for the "you are #4" email. Cancellations
          // and promotions shrink `pendingCount` without renumbering anyone, so
          // treat it as a snapshot, not a live rank.
          waitlistPosition: event.pendingCount + 1,
        };

    transaction.set(documents.guest, guest);
    // `existing` here is only ever a cancelled or expired guest, which no
    // counter is counting — so this is a plain increment, not a move.
    applyCounters(
      transaction,
      documents.event,
      event,
      existing?.status ?? null,
      guest.status,
    );

    return {
      outcome: outcomeFor(guest.status),
      alreadyRegistered: false,
      guest,
    };
  });
}

/** The guest document for someone who got a place rather than a queue ticket. */
function takenSeat(
  base: Omit<Guest, 'status'>,
  mode: ReserveMode,
  now: Timestamp,
  draft: GuestDraft,
): Guest {
  const status: GuestStatus = mode === 'confirm' ? 'confirmed' : 'held';

  return mode === 'confirm'
    ? { ...base, status, confirmedAt: now }
    : {
        ...base,
        status,
        ...(draft.holdExpiresAt ? { holdExpiresAt: draft.holdExpiresAt } : {}),
        ...(draft.stripeSessionId
          ? { stripeSessionId: draft.stripeSessionId }
          : {}),
      };
}
