import type { Guest } from '@upskills/models';
import { Timestamp } from 'firebase-admin/firestore';
import { eventRef, guestRef, guestsCol } from './collections';
import {
  EventNotFoundError,
  applyCounters,
  clearFields,
  guestFromSnapshot,
  runIdempotentTransaction,
} from './transactions';

/**
 * The registration lifecycle after `reserveSpot`.
 *
 * Every function here is one transaction that moves a guest between statuses
 * and adjusts the event counters to match, in the same commit. The invariant
 * they exist to hold is exact and testable: for every event, the number of
 * guests in each of `confirmed` / `held` / `pending` equals
 * `confirmedCount` / `heldCount` / `pendingCount`. `transitions.spec.ts`
 * asserts it after every mixed sequence it can build.
 */

/** Why a transition left the guest where it found them. */
export type TransitionReason =
  /** No guest document for that email on that event. */
  | 'not-found'
  /** The guest was already in the target status — the safe, idempotent case. */
  | 'already-applied'
  /** The guest is in a status this transition does not apply to. */
  | 'wrong-status';

export interface TransitionResult {
  /** `true` when this call moved the guest and adjusted the counters. */
  changed: boolean;
  /** The guest as it now stands, or `null` when there is no such guest. */
  guest: Guest | null;
  /** Set only when `changed` is `false`. */
  reason?: TransitionReason;
}

/** What Stripe told us about the payment that turned a hold into a seat. */
export interface PaymentInfo {
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  /** Amount actually paid, in **minor units** (cents). */
  amountPaid?: number;
}

/**
 * A paid reservation becomes a real seat: `held` → `confirmed`, `heldCount--`,
 * `confirmedCount++`.
 *
 * Driven by the `checkout.session.completed` webhook. Idempotent by design —
 * Stripe retries deliveries, and a redelivery must not double-count a guest
 * who is already `confirmed`. `holdExpiresAt` is dropped, so the expiry sweep
 * cannot later reclaim a seat that has been paid for.
 */
export async function confirmHeldGuest(
  eventId: string,
  email: string,
  payment: PaymentInfo = {},
): Promise<TransitionResult> {
  return transition(eventId, email, (existing) => {
    if (existing.status === 'confirmed') {
      return { reason: 'already-applied' };
    }

    if (existing.status !== 'held') {
      return { reason: 'wrong-status' };
    }

    return {
      next: {
        ...clearFields(existing, 'holdExpiresAt'),
        status: 'confirmed',
        confirmedAt: Timestamp.now(),
        ...definedPayment(payment),
      },
    };
  });
}

/**
 * A hold whose payment never landed gives the seat back: `held` → `expired`,
 * `heldCount--`.
 *
 * Driven by `checkout.session.expired` and by the `expire-holds` sweep. The
 * guest keeps their document — `expired` is a record of the attempt, not a
 * deletion — and may register again, which `reserveSpot` treats as fresh.
 * Callers normally follow this with {@link promoteNextPending}.
 */
export async function releaseHold(
  eventId: string,
  email: string,
): Promise<TransitionResult> {
  return transition(eventId, email, (existing) => {
    if (existing.status === 'expired') {
      return { reason: 'already-applied' };
    }

    if (existing.status !== 'held') {
      return { reason: 'wrong-status' };
    }

    return {
      next: { ...clearFields(existing, 'holdExpiresAt'), status: 'expired' },
    };
  });
}

/**
 * Give a place back, whichever kind of place it was.
 *
 * The counter to decrement is decided from the guest's *current* status read
 * inside the transaction, not from what the caller believed when they clicked
 * cancel — a guest can be promoted off the waitlist between the email being
 * opened and the link being followed.
 *
 * Cancelling an already-cancelled guest is a no-op, not an error: cancel links
 * live in inboxes forever and get clicked twice. An `expired` hold is reported
 * as `wrong-status` — there is nothing left to release, and overwriting it
 * would erase why the reservation ended.
 *
 * Callers normally follow this with {@link promoteNextPending}.
 */
export async function cancelGuest(
  eventId: string,
  email: string,
): Promise<TransitionResult> {
  return transition(eventId, email, (existing) => {
    if (existing.status === 'cancelled') {
      return { reason: 'already-applied' };
    }

    if (existing.status === 'expired') {
      return { reason: 'wrong-status' };
    }

    return {
      next: {
        ...clearFields(existing, 'waitlistPosition', 'holdExpiresAt'),
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
      },
    };
  });
}

/**
 * Move the longest-waiting guest off the waitlist and into the freed seat:
 * oldest `pending` by `registeredAt` → `confirmed`, `pendingCount--`,
 * `confirmedCount++`. Returns the promoted guest, or `null` when the waitlist
 * is empty or the event has no room to give.
 *
 * ## Why two simultaneous cancellations cannot promote the same guest
 *
 * The waitlist query runs *inside* the transaction, and the transaction also
 * writes the event document. Two concurrent promotions therefore conflict on
 * that one document: the loser is retried, re-runs the query against a waitlist
 * whose head is now `confirmed`, and takes the next guest instead. Reading the
 * waitlist before opening a transaction would hand both of them the same guest.
 *
 * The capacity check is not ceremony either. Promotion is triggered by a
 * cancellation, but nothing stops a caller invoking it twice, or a refund
 * webhook racing a manual cancel; without it a full event would quietly
 * oversell. Backed by the `guests (status ASC, registeredAt ASC)` index.
 */
export async function promoteNextPending(
  eventId: string,
): Promise<Guest | null> {
  const documents = { event: eventRef(eventId) };
  const oldestPending = guestsCol(eventId)
    .where('status', '==', 'pending')
    .orderBy('registeredAt', 'asc')
    .limit(1);

  return runIdempotentTransaction(async (transaction) => {
    // Reads first, both of them.
    const eventSnapshot = await transaction.get(documents.event);
    const waitlist = await transaction.get(oldestPending);

    const event = eventSnapshot.data();
    if (!event) {
      throw new EventNotFoundError(eventId);
    }

    const head = waitlist.docs[0];
    if (!head) {
      return null;
    }

    const hasRoom =
      event.maxGuests === 0 ||
      event.confirmedCount + event.heldCount < event.maxGuests;
    if (!hasRoom) {
      return null;
    }

    const existing = guestFromSnapshot(eventId, head);
    if (!existing) {
      return null;
    }

    const next: Guest = {
      ...clearFields(existing, 'waitlistPosition'),
      status: 'confirmed',
      confirmedAt: Timestamp.now(),
    };

    transaction.set(head.ref, next);
    applyCounters(transaction, documents.event, event, 'pending', 'confirmed');

    return next;
  });
}

/** What a transition decided: either a new guest document, or why not. */
type Decision =
  { next: Guest; reason?: never } | { next?: never; reason: TransitionReason };

/**
 * The shape every single-guest transition shares: read the event and the guest,
 * let `decide` produce the next document, then write both the guest and the
 * counter move in one commit.
 *
 * @throws EventNotFoundError if `eventId` names no event.
 */
async function transition(
  eventId: string,
  email: string,
  decide: (existing: Guest) => Decision,
): Promise<TransitionResult> {
  const documents = {
    event: eventRef(eventId),
    guest: guestRef(eventId, email),
  };

  return runIdempotentTransaction(async (transaction) => {
    // Reads before writes — Firestore will reject the transaction otherwise.
    const eventSnapshot = await transaction.get(documents.event);
    const guestSnapshot = await transaction.get(documents.guest);

    const event = eventSnapshot.data();
    if (!event) {
      throw new EventNotFoundError(eventId);
    }

    const existing = guestFromSnapshot(eventId, guestSnapshot);
    if (!existing) {
      return { changed: false, guest: null, reason: 'not-found' as const };
    }

    const decision = decide(existing);
    if (!decision.next) {
      return { changed: false, guest: existing, reason: decision.reason };
    }

    transaction.set(documents.guest, decision.next);
    applyCounters(
      transaction,
      documents.event,
      event,
      existing.status,
      decision.next.status,
    );

    return { changed: true, guest: decision.next };
  });
}

/** Only the payment fields Stripe actually reported, so a full overwrite of the
 * guest document does not blank out ones it did not. */
function definedPayment(payment: PaymentInfo): PaymentInfo {
  return {
    ...(payment.stripeSessionId !== undefined
      ? { stripeSessionId: payment.stripeSessionId }
      : {}),
    ...(payment.stripePaymentIntentId !== undefined
      ? { stripePaymentIntentId: payment.stripePaymentIntentId }
      : {}),
    ...(payment.amountPaid !== undefined
      ? { amountPaid: payment.amountPaid }
      : {}),
  };
}
