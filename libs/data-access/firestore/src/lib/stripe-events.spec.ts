import type { Guest } from '@upskills/models';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent, seedGuest } from '../testing/seed';
import { eventRef, guestRef, stripeEventRef } from './collections';
import { getEvent, getGuest } from './reads';
import { isStripeEventProcessed, withStripeEventGuard } from './stripe-events';

/**
 * Issue #35 — one Stripe event, one effect, however many deliveries.
 *
 * Every test here goes through {@link deliverCheckoutCompleted}, a stand-in for
 * the real `checkout.session.completed` handler: it confirms the held guest,
 * moves the event counters, and sends a receipt *after* the commit and only
 * when the delivery actually applied. That last part is the whole point — the
 * email is the side effect Stripe's retries would duplicate.
 */

const EVENT_ID = 'evt-paid';
const ORG_ID = 'org-1';
const EMAIL = 'buyer@example.com';
const STRIPE_EVENT_ID = 'evt_stripe_1';

/** Receipts "sent" by the handler — one entry per email a guest would get. */
let receipts: string[] = [];

beforeEach(async () => {
  await clearFirestore();
  receipts = [];
  await seedEvent({ eventId: EVENT_ID, price: 2500, heldCount: 1 });
  await seedGuest({
    eventId: EVENT_ID,
    email: EMAIL,
    status: 'held',
    holdExpiresAt: Timestamp.now(),
    stripeSessionId: 'cs_test_1',
  });
});

describe('withStripeEventGuard', () => {
  it('applies the effect on the first delivery', async () => {
    const outcome = await deliverCheckoutCompleted();

    expect(outcome).toEqual({ applied: true, result: EMAIL });
    expect(await getGuest(ORG_ID, EVENT_ID, EMAIL)).toMatchObject({
      status: 'confirmed',
    });
    expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
      confirmedCount: 1,
      heldCount: 0,
    });
    expect(receipts).toEqual([EMAIL]);
  });

  it('writes the ledger entry in the same commit as the effect', async () => {
    await deliverCheckoutCompleted();

    const entry = (await stripeEventRef(STRIPE_EVENT_ID).get()).data();
    expect(entry).toMatchObject({
      stripeEventId: STRIPE_EVENT_ID,
      type: 'checkout.session.completed',
    });
    expect(entry?.processedAt).toBeInstanceOf(Timestamp);
  });

  it('ignores a redelivery of the same event: one guest, one email', async () => {
    await deliverCheckoutCompleted();
    const replay = await deliverCheckoutCompleted();

    expect(replay).toEqual({ applied: false });
    // The counters are the tell: a second application would push
    // `confirmedCount` to 2 with only one guest to show for it.
    expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
      confirmedCount: 1,
      heldCount: 0,
    });
    expect(receipts).toEqual([EMAIL]);
  });

  it('stays at one application no matter how many times Stripe retries', async () => {
    for (let delivery = 0; delivery < 5; delivery++) {
      await deliverCheckoutCompleted();
    }

    expect(receipts).toEqual([EMAIL]);
    expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
      confirmedCount: 1,
    });
  });

  it('gates per event id, so a different event still applies', async () => {
    await deliverCheckoutCompleted();

    // A refund or a second purchase is a different Stripe event; the ledger
    // must not swallow it.
    const other = await withStripeEventGuard('evt_stripe_2', async () => 'ok');

    expect(other).toEqual({ applied: true, result: 'ok' });
    expect(await isStripeEventProcessed('evt_stripe_2')).toBe(true);
  });

  it('rolls the ledger back with the effect when the effect throws', async () => {
    const failure = await deliverCheckoutCompleted({ fail: true }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(HandlerFailed);

    // Neither half landed: no ledger entry...
    expect(await isStripeEventProcessed(STRIPE_EVENT_ID)).toBe(false);
    // ...and none of the writes the effect had already queued.
    expect(await getGuest(ORG_ID, EVENT_ID, EMAIL)).toMatchObject({
      status: 'held',
    });
    expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
      confirmedCount: 0,
      heldCount: 1,
    });
    expect(receipts).toEqual([]);
  });

  it('applies on the retry after a failed delivery', async () => {
    // The reason a failed handler must not record the event: Stripe answers a
    // non-2xx by redelivering, and that redelivery is the one that has to work.
    await expect(deliverCheckoutCompleted({ fail: true })).rejects.toThrow(
      HandlerFailed,
    );

    const retry = await deliverCheckoutCompleted();

    expect(retry).toEqual({ applied: true, result: EMAIL });
    expect(receipts).toEqual([EMAIL]);
    expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
      confirmedCount: 1,
    });
  });

  it(
    'applies exactly once when the same delivery arrives concurrently',
    async () => {
      // Stripe can have several deliveries of one event in flight at once —
      // and so can two instances of the app behind a load balancer.
      const settled = await Promise.all(
        Array.from({ length: DUPLICATE_DELIVERIES }, () =>
          deliverCheckoutCompleted(),
        ),
      );

      expect(settled.filter((outcome) => outcome.applied)).toHaveLength(1);
      expect(receipts).toEqual([EMAIL]);
      expect(await getEvent(ORG_ID, EVENT_ID)).toMatchObject({
        confirmedCount: 1,
        heldCount: 0,
      });
    },
    RACE_TIMEOUT_MS,
  );

  it('rejects an event id that is not a usable document key', async () => {
    await expect(
      withStripeEventGuard('evt/../nope', async () => 'ok'),
    ).rejects.toThrow(/not a usable Stripe event id/);
    await expect(withStripeEventGuard('  ', async () => 'ok')).rejects.toThrow(
      /not a usable Stripe event id/,
    );
  });
});

describe('isStripeEventProcessed', () => {
  it('reports whether the ledger has seen the event', async () => {
    expect(await isStripeEventProcessed(STRIPE_EVENT_ID)).toBe(false);

    await deliverCheckoutCompleted();

    expect(await isStripeEventProcessed(STRIPE_EVENT_ID)).toBe(true);
  });
});

/** Simultaneous deliveries of one event. */
const DUPLICATE_DELIVERIES = 10;

/** Contention takes real time; generous so a slow machine fails honestly. */
const RACE_TIMEOUT_MS = 120_000;

/** Thrown from inside the guarded effect, to prove the rollback. */
class HandlerFailed extends Error {
  constructor() {
    super('handler blew up mid-transaction');
    this.name = 'HandlerFailed';
  }
}

/**
 * The `checkout.session.completed` handler, in miniature.
 *
 * Note the shape: the work runs on the transaction the guard hands it — it does
 * *not* call `confirmHeldGuest`, which would open a transaction of its own and
 * commit outside the gate.
 */
async function deliverCheckoutCompleted(options: { fail?: boolean } = {}) {
  const outcome = await withStripeEventGuard(
    STRIPE_EVENT_ID,
    async (transaction: Transaction) => {
      const documents = {
        event: eventRef(ORG_ID, EVENT_ID),
        guest: guestRef(ORG_ID, EVENT_ID, EMAIL),
      };

      // Reads first, inside the transaction, exactly as the real handler must.
      const eventSnapshot = await transaction.get(documents.event);
      const guestSnapshot = await transaction.get(documents.guest);
      const event = eventSnapshot.data();
      const guest = guestSnapshot.data();
      if (!event || !guest) {
        throw new Error('fixture missing');
      }

      const confirmed: Guest = {
        ...guest,
        status: 'confirmed',
        confirmedAt: Timestamp.now(),
      };
      transaction.set(documents.guest, confirmed);
      transaction.update(documents.event, {
        heldCount: event.heldCount - 1,
        confirmedCount: event.confirmedCount + 1,
      });

      // Deliberately *after* the writes are queued: the failure has to take
      // them down with it, not merely happen before they existed.
      if (options.fail) {
        throw new HandlerFailed();
      }

      return confirmed.email;
    },
    { type: 'checkout.session.completed' },
  );

  // Post-commit, and only for the delivery that applied: this is the email a
  // retry would otherwise send twice.
  if (outcome.applied) {
    receipts.push(outcome.result);
  }

  return outcome;
}
