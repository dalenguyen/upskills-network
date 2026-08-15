import type { Guest, GuestStatus, WorkshopEvent } from '@upskills/models';
import { randomBytes } from 'node:crypto';
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
  UpdateData,
} from 'firebase-admin/firestore';
import { getDb } from './db';

/**
 * The shared machinery behind every mutation in this library.
 *
 * ## The pattern
 *
 * Every write path in here is one `runTransaction` shaped the same way:
 *
 * 1. **Read everything first.** Firestore rejects a transaction that reads
 *    after it writes, so the reads are not just first by convention — the API
 *    will not accept any other order.
 * 2. **Decide from what the transaction just read**, never from a value the
 *    caller fetched earlier. "Count the guests, then create one if there's
 *    room" is a lost update: two racers read the same count, both see a seat,
 *    both write. The re-read inside the transaction is the entire point.
 * 3. **Write absolute counter values**, computed from that read — not
 *    `FieldValue.increment`. Inside a transaction the read value is guaranteed
 *    current at commit, so `confirmedCount: event.confirmedCount + 1` is exactly
 *    as safe as an increment, and it lets {@link nextCount} clamp at zero so a
 *    double-decrement can never push a counter negative.
 * 4. **Write the whole guest document** with `transaction.set`, built from the
 *    snapshot the transaction read. A full overwrite is how a field stops
 *    applying — `waitlistPosition` disappears on promotion, `holdExpiresAt` on
 *    confirmation — without a `FieldValue.delete()` at every call site.
 *
 * ## Why touching the event doc is what serializes everything
 *
 * Every mutation writes `events/{eventId}`, even when it is only adjusting a
 * counter. That single contended document is what makes concurrent callers
 * serialize: two simultaneous promotions cannot both take the same waitlisted
 * guest, because the second transaction's write to the event doc conflicts, it
 * is retried, and on the retry it re-reads a waitlist that no longer contains
 * the guest the first one took.
 */

/**
 * How many times a transaction is retried before the failure reaches the
 * caller. The Admin SDK's default of 5 is tuned for incidental contention; a
 * registration burst on one popular event is *sustained* contention on a single
 * document, where the losers need to queue behind the winner. Generous enough
 * that a realistic burst resolves as a slow registration rather than a 500.
 */
export const MAX_TRANSACTION_ATTEMPTS = 25;

/**
 * How many times a *fresh* transaction is started after the SDK's own retries
 * are exhausted.
 *
 * Small on purpose. The SDK's 25 attempts already carry their own tuned
 * backoff, and they resolve essentially every burst; a restart exists only for
 * the rare case where that whole transaction is no longer usable. Making this
 * large — or pairing it with a long sleep of our own — stacks delay on top of
 * the SDK's and turns a 6-second burst into a 25-second one.
 */
export const MAX_RESTARTS = 3;

/**
 * Base for the jittered pause before a restart.
 *
 * Deliberately tiny: by the time a restart happens the SDK has already backed
 * off across 25 attempts, so this only staggers simultaneous losers rather than
 * adding meaningful delay.
 */
const RESTART_BACKOFF_MS = 10;

/**
 * Run `body` as a read-write transaction with this library's contention policy.
 *
 * Use this rather than `getDb().runTransaction` directly, so every mutation in
 * the library retries the same way.
 *
 * ## Why two levels of retry
 *
 * A registration burst is *sustained* contention on one document — every writer
 * touches `events/{eventId}` — so the SDK's default of 5 attempts is not always
 * enough. Simply raising `maxAttempts` is the wrong fix, though: all of those
 * attempts happen inside a single `runTransaction` call, and a long enough
 * losing streak leaves the server-side transaction stale, which surfaces as
 * `INVALID_ARGUMENT: Transaction is invalid or closed` rather than as honest
 * contention. That was observed at `maxAttempts: 25` under a 20-way burst.
 *
 * So the budget is split: the SDK retries a handful of times against one
 * transaction, and if that whole transaction fails on contention we start a
 * brand-new one. A fresh transaction cannot inherit a stale handle, and the
 * jittered backoff spreads the herd out instead of having every loser retry in
 * lockstep.
 */
export function runTransaction<T>(
  body: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return getDb().runTransaction(body, {
    maxAttempts: MAX_TRANSACTION_ATTEMPTS,
  });
}

/**
 * Like {@link runTransaction}, but starts a **fresh** transaction if the whole
 * thing fails on contention.
 *
 * ## Only for idempotent bodies — this is not the default for a reason
 *
 * When the SDK reports `ABORTED`, the commit may in fact have landed and only
 * the response been lost. Re-running the body then applies it a second time.
 * For a body that converges on the same state — `reserveSpot` re-reads the
 * guest and answers "already registered"; a status transition re-reads and
 * finds its work done — that is harmless.
 *
 * For a body whose whole purpose is to happen **once**, it is a correctness
 * bug. Using this for `reserveSlug` let two of twenty-five racers both come
 * away believing they owned the same slug, which is precisely what the
 * reservation document exists to prevent. Create-once paths must use
 * {@link runTransaction}, whose only retries are the SDK's own — those re-read
 * inside one transaction and cannot double-apply.
 *
 * What this buys is the stale-handle case: 25 attempts inside a single
 * transaction can outlive it, surfacing as `INVALID_ARGUMENT: Transaction is
 * invalid or closed`. A fresh transaction cannot inherit a stale handle.
 */
export async function runIdempotentTransaction<T>(
  body: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let restart = 0; restart < MAX_RESTARTS; restart++) {
    try {
      return await getDb().runTransaction(body, {
        maxAttempts: MAX_TRANSACTION_ATTEMPTS,
      });
    } catch (error) {
      if (!isContention(error)) {
        throw error;
      }

      lastError = error;
      // Full jitter: every loser picks its own delay, so they do not all wake
      // up together and collide again.
      const ceiling = RESTART_BACKOFF_MS * 2 ** restart;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * ceiling),
      );
    }
  }

  throw new TransactionContendedError(MAX_RESTARTS, lastError);
}

/** gRPC status codes that mean "another writer won; try again". */
const ABORTED = 10;
const DEADLINE_EXCEEDED = 4;
const INVALID_ARGUMENT = 3;

/**
 * `true` when the failure is contention rather than a real fault.
 *
 * `INVALID_ARGUMENT` is normally a programming error, so it only counts when
 * the message identifies the stale-transaction case — never in general.
 */
function isContention(error: unknown): boolean {
  const { code, message } = (error ?? {}) as {
    code?: number;
    message?: string;
  };

  if (code === ABORTED || code === DEADLINE_EXCEEDED) {
    return true;
  }

  return (
    code === INVALID_ARGUMENT &&
    /transaction is invalid or closed/i.test(message ?? '')
  );
}

/**
 * Raised when a mutation could not commit because the event stayed contended.
 *
 * Distinct from a bug: it means the document was too hot for too long, and the
 * caller should retry or tell the guest to try again — a route should map it to
 * 503, never to a 500.
 */
export class TransactionContendedError extends Error {
  constructor(
    readonly restarts: number,
    // `Error` already declares `cause`, so this narrows it rather than
    // introducing a new field.
    override readonly cause?: unknown,
  ) {
    super(
      `Transaction still contended after ${restarts} restarts; the document is too hot to commit right now.`,
    );
    this.name = 'TransactionContendedError';
  }
}

/**
 * Statuses that occupy a place on the event — a seat, a paid hold, or a rung on
 * the waitlist. Re-registering while in one of these is a no-op; the other two
 * (`cancelled`, `expired`) have already given their place back, so registering
 * again is a genuinely new reservation.
 */
export const ACTIVE_STATUSES: readonly GuestStatus[] = [
  'confirmed',
  'held',
  'pending',
];

/** The event counter that a guest in this status is counted by. */
export const COUNTER_FIELD = {
  confirmed: 'confirmedCount',
  held: 'heldCount',
  pending: 'pendingCount',
} as const satisfies Partial<Record<GuestStatus, keyof WorkshopEvent>>;

/** `true` when this guest currently occupies a place on the event. */
export function isActive(status: GuestStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * A counter after `delta`, floored at zero.
 *
 * The floor is a backstop, not the mechanism: transactions are what keep the
 * counters honest. But a counter that has drifted (a hand-edited document, a
 * restored backup) must not be able to go negative and turn a capacity check
 * into an oversell.
 */
export function nextCount(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

/**
 * The counter patch for a guest moving `from` one status `to` another.
 *
 * Either side may be `null`: a brand-new registration comes from nowhere, and
 * `expired`/`cancelled` are counted by nothing. A transition that does not move
 * between counters yields an empty patch, so no write is wasted.
 */
export function counterPatch(
  event: WorkshopEvent,
  from: GuestStatus | null,
  to: GuestStatus | null,
): UpdateData<WorkshopEvent> {
  if (from === to) {
    return {};
  }

  const patch: Record<string, number> = {};
  const apply = (status: GuestStatus | null, delta: number) => {
    const field = status ? counterFieldFor(status) : null;
    if (field) {
      patch[field] = nextCount(patch[field] ?? event[field], delta);
    }
  };

  apply(from, -1);
  apply(to, +1);

  return patch;
}

/**
 * Write the counter move for a guest going `from` one status `to` another.
 *
 * Prefer this over calling {@link counterPatch} and `transaction.update`
 * yourself: a transition that moves no counter produces an empty patch, and
 * Firestore rejects an `update()` with no fields.
 */
export function applyCounters(
  transaction: Transaction,
  eventDoc: DocumentReference<WorkshopEvent>,
  event: WorkshopEvent,
  from: GuestStatus | null,
  to: GuestStatus | null,
): void {
  const patch = counterPatch(event, from, to);

  if (Object.keys(patch).length > 0) {
    transaction.update(eventDoc, patch);
  }
}

function counterFieldFor(
  status: GuestStatus,
): (typeof COUNTER_FIELD)[keyof typeof COUNTER_FIELD] | null {
  return status in COUNTER_FIELD
    ? COUNTER_FIELD[status as keyof typeof COUNTER_FIELD]
    : null;
}

/**
 * A guest snapshot as a model, with the id and event stamped on from the path.
 *
 * The path is authoritative: it is what the document actually is, whatever the
 * body claims.
 */
export function guestFromSnapshot(
  eventId: string,
  snapshot: DocumentSnapshot<Guest>,
): Guest | null {
  const data = snapshot.data();
  return data ? { ...data, guestId: snapshot.id, eventId } : null;
}

/**
 * Guest fields that only mean something in one status: a rank while queued, an
 * expiry while mid-checkout, a moment of confirmation or cancellation.
 */
type ClearableGuestField =
  'waitlistPosition' | 'holdExpiresAt' | 'confirmedAt' | 'cancelledAt';

/**
 * `guest` with `fields` removed.
 *
 * Because every transition writes the whole document with `transaction.set`,
 * rebuilding it without a field is how that field stops applying — a promoted
 * guest has no waitlist rank, a paid one has no hold expiry. Doing it here,
 * rather than with a `FieldValue.delete()` per field at each call site, keeps
 * the returned in-memory guest identical to the document that was stored.
 */
export function clearFields(
  guest: Guest,
  ...fields: ClearableGuestField[]
): Guest {
  const next = { ...guest };
  for (const field of fields) {
    delete next[field];
  }

  return next;
}

/**
 * A random, unguessable cancellation token.
 *
 * It travels in the confirmation email and is the *only* thing standing between
 * a stranger and cancelling someone else's spot, so it is generated from
 * `crypto`, never from the email or the timestamp.
 */
export function newCancelToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Raised when a mutation names an event that does not exist. */
export class EventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`Event "${eventId}" does not exist.`);
    this.name = 'EventNotFoundError';
  }
}

/**
 * Raised when an event exists but is not open for registration — it is still a
 * draft, or it has been cancelled.
 *
 * Checked *inside* the reservation transaction, alongside capacity, rather than
 * by the caller beforehand. A route that read the event, saw `published`, and
 * then called `reserveSpot` would leave a window in which the organizer
 * cancels the event and a registration still lands on it — the same lost-update
 * shape as counting seats before taking one. The status is a condition on the
 * event document, so it is tested against the copy read in the transaction.
 */
export class EventNotRegisterableError extends Error {
  constructor(
    readonly eventId: string,
    /** The event's status at the moment the transaction read it. */
    readonly status: string,
  ) {
    super(`Event "${eventId}" is not open for registration (${status}).`);
    this.name = 'EventNotRegisterableError';
  }
}

/**
 * Raised when a free seat is claimed outright on an event that costs money.
 *
 * Checked inside the reservation transaction against the price read there, so a
 * caller cannot read the price, see zero, and reserve after the organizer has
 * put a number on it. A route that gated on its own earlier read would leave
 * exactly that window, and the seat it let through would be a paid seat given
 * away for nothing.
 *
 * Only `confirm` mode raises this. `hold` is the paid path: it reserves the
 * seat *pending* payment, which is precisely what a priced event needs.
 */
export class PaymentRequiredError extends Error {
  constructor(
    readonly eventId: string,
    /** Price in minor units, as read inside the transaction. */
    readonly price: number,
  ) {
    super(
      `Event "${eventId}" costs ${price} and cannot be confirmed for free.`,
    );
    this.name = 'PaymentRequiredError';
  }
}
