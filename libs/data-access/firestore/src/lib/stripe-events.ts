import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { stripeEventRef } from './collections';
import { runTransaction } from './transactions';

/**
 * The webhook idempotency ledger: `stripeEvents/{stripeEventId}`.
 *
 * ## What goes wrong without it
 *
 * Stripe retries a delivery on any non-2xx, on a timeout, and occasionally for
 * no reason we can see. A second `checkout.session.completed` for one payment
 * must not create a second guest or send a second receipt to somebody who paid
 * once. The ledger is what makes "have we already handled this?" answerable —
 * an existence check on a key, not a query.
 *
 * ## Why the API is a callback and not a boolean
 *
 * Issue #35 sketches `markStripeEventProcessed(id): Promise<boolean>` — call
 * it, and do the work if it says `true`. That shape *cannot* be used safely,
 * and the failure is silent:
 *
 * - As two commits, there is a window between them. The ledger entry commits,
 *   the process dies before the guest is confirmed, Stripe retries, the gate
 *   now says "already handled" — and the payment is dropped on the floor. Flip
 *   the order and the crash instead double-applies. There is no order of two
 *   commits that is correct.
 * - Even a transaction-scoped `mark(transaction, id)` that read *and* wrote the
 *   ledger would be a trap: its write would precede the effect's reads, and
 *   Firestore rejects a read after a write. Callers would discover this only at
 *   runtime, on the paid path.
 *
 * So the ledger read, the effect, and the ledger write are one function that
 * owns the ordering: {@link withStripeEventGuard} reads the gate first (before
 * anything can write), hands the *same* transaction to the effect, and writes
 * the ledger entry last. The guard and the thing it guards commit together or
 * not at all — a crash anywhere leaves nothing written, and Stripe's retry
 * applies it exactly once.
 *
 * The corollary for callers: the effect must do its work **on the transaction
 * it is given**. `confirmHeldGuest(...)` and friends open their own
 * transaction, so calling one inside the effect would commit outside the guard
 * and defeat it.
 */

/** What one guarded delivery did. */
export type StripeEventOutcome<T> =
  /** First delivery: the effect ran, and it and the ledger entry committed together. */
  | { applied: true; result: T }
  /** A replay of an event already in the ledger. The effect did not run. */
  | { applied: false; result?: undefined };

export interface StripeEventGuardOptions {
  /** Stripe's event type, recorded on the ledger entry for incident triage. */
  type?: string;
}

/**
 * Run `effect` exactly once for `stripeEventId`, however many times Stripe
 * delivers it.
 *
 * The effect receives the transaction the guard is running in and must do all
 * of its reads before any of its writes — the usual Firestore rule, and the
 * reason the guard reads the ledger before calling it.
 *
 * ```ts
 * const outcome = await withStripeEventGuard(
 *   stripeEvent.id,
 *   async (transaction) => {
 *     const guest = await transaction.get(guestRef(eventId, email));
 *     // …read the event, then write both…
 *     return guest.id;
 *   },
 *   { type: stripeEvent.type },
 * );
 *
 * // Emails go out only on the delivery that actually applied, and only after
 * // the commit — a replay is silent, and a rollback sends nothing.
 * if (outcome.applied) {
 *   await sendPaymentReceiptEmail(outcome.result);
 * }
 * ```
 *
 * An effect that throws takes the ledger entry down with it: nothing is
 * written, and the next delivery of that event retries from scratch. That is
 * deliberate — a failed handler is not a handled event. Let the throw reach the
 * route and answer non-2xx so Stripe redelivers.
 */
export async function withStripeEventGuard<T>(
  stripeEventId: string,
  effect: (transaction: Transaction) => Promise<T>,
  options: StripeEventGuardOptions = {},
): Promise<StripeEventOutcome<T>> {
  const id = assertStripeEventId(stripeEventId);

  return runTransaction(async (transaction) => {
    const ledger = stripeEventRef(id);

    // The gate is read before anything else: it must precede the effect's own
    // reads (a read here would be illegal once the effect has written), and
    // reading the missing key is what puts it in the transaction's read set,
    // so a concurrent duplicate delivery aborts instead of both applying.
    const alreadyProcessed = (await transaction.get(ledger)).exists;
    if (alreadyProcessed) {
      return { applied: false } as const;
    }

    const result = await effect(transaction);

    // Written last, after the effect's writes, so the effect is free to read.
    // `create` rather than `set`: if a racer slipped an entry in between the
    // read and the commit, this fails the whole transaction — including the
    // effect — rather than applying it a second time.
    transaction.create(ledger, {
      stripeEventId: id,
      ...(options.type !== undefined ? { type: options.type } : {}),
      processedAt: Timestamp.now(),
    });

    return { applied: true, result } as const;
  }).catch((error) => asAlreadyApplied<T>(error, id));
}

/**
 * Whether this Stripe event is already in the ledger.
 *
 * For dashboards, support questions and tests. Deliberately **not** a gate:
 * checking this and then acting is the two-commit race described above, so a
 * handler must use {@link withStripeEventGuard} instead.
 */
export async function isStripeEventProcessed(
  stripeEventId: string,
): Promise<boolean> {
  return (await stripeEventRef(assertStripeEventId(stripeEventId)).get())
    .exists;
}

/** gRPC `ALREADY_EXISTS` — what the ledger's `create` backstop fails with. */
const ALREADY_EXISTS = 6;

/**
 * A racer that created the ledger entry first means this delivery is a replay,
 * which is the ordinary `applied: false` answer rather than an error.
 *
 * Only reachable if the entry appeared after the gate read and the transaction
 * still committed; the read set normally turns that into a retry, which then
 * sees the entry and returns `applied: false` on its own.
 *
 * ## Why the ledger is re-read rather than trusting the code alone
 *
 * `ALREADY_EXISTS` names no document, and the effect runs in this transaction —
 * so an effect that creates a document of its own (`reserveSlug` does exactly
 * that) can raise the same code. Treating that as a replay would answer
 * `applied: false` for work that never happened, silently dropping a payment.
 *
 * So the code alone is not enough: the ledger entry has to actually be there.
 * If it is, some delivery of this event applied and this one is genuinely a
 * replay; if it is not, the collision came from the effect and belongs to the
 * caller.
 */
async function asAlreadyApplied<T>(
  error: unknown,
  stripeEventId: string,
): Promise<StripeEventOutcome<T>> {
  if (
    (error as { code?: number } | null)?.code === ALREADY_EXISTS &&
    (await stripeEventRef(stripeEventId).get()).exists
  ) {
    return { applied: false };
  }

  throw error;
}

/**
 * Stripe event ids are opaque to us, so the only thing worth checking is that
 * the id can be a document id at all. A `/` would address a subcollection and
 * quietly gate on the wrong key, which is worse than a loud failure.
 */
function assertStripeEventId(stripeEventId: string): string {
  const id = stripeEventId.trim();

  if (id === '' || id.includes('/')) {
    throw new Error(
      `"${stripeEventId}" is not a usable Stripe event id — the idempotency ledger is keyed by it.`,
    );
  }

  return id;
}
