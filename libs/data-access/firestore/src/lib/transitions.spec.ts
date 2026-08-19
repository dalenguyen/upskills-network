import type { GuestStatus, WorkshopEvent } from '@upskills/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { at, seedEvent, seedGuest } from '../testing/seed';
import { getEvent, getGuest, listEventGuests } from './reads';
import { reserveSpot } from './reserve-spot';
import { EventNotFoundError } from './transactions';
import {
  cancelGuest,
  confirmHeldGuest,
  promoteNextPending,
  releaseHold,
} from './transitions';

beforeEach(clearFirestore);

const event = (overrides: Partial<WorkshopEvent> = {}) =>
  seedEvent({ eventId: 'evt-1', orgId: 'org-7', maxGuests: 10, ...overrides });

/**
 * The invariant the whole issue is about: every guest is counted exactly once,
 * by exactly the counter its status names.
 *
 * `step` names the transition that ran just before, so a break in a long
 * sequence points at the transition that caused it rather than the sequence.
 */
async function expectCountersMatchGuests(
  eventId: string,
  step = 'the last transition',
  orgId = 'org-7',
): Promise<void> {
  const guests = await listEventGuests(orgId, eventId);
  const tally = (status: GuestStatus) =>
    guests.filter((guest) => guest.status === status).length;

  expect(
    await getEvent(orgId, eventId),
    `counters after ${step}`,
  ).toMatchObject({
    confirmedCount: tally('confirmed'),
    heldCount: tally('held'),
    pendingCount: tally('pending'),
  });
}

describe('confirmHeldGuest', () => {
  it('turns a hold into a seat and moves both counters', async () => {
    await event({ heldCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'buyer@e.com',
      status: 'held',
      holdExpiresAt: at(30),
      confirmedAt: undefined,
    });

    const result = await confirmHeldGuest('org-7', 'evt-1', 'Buyer@E.com', {
      stripeSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_1',
      amountPaid: 2500,
    });

    expect(result.changed).toBe(true);
    expect(result.guest).toMatchObject({
      status: 'confirmed',
      stripeSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_1',
      amountPaid: 2500,
    });
    expect(result.guest?.confirmedAt).toBeDefined();
    // Dropped, so the expiry sweep can never reclaim a paid-for seat.
    expect(result.guest?.holdExpiresAt).toBeUndefined();
    expect(
      (await getGuest('org-7', 'evt-1', 'buyer@e.com'))?.holdExpiresAt,
    ).toBeUndefined();

    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 1,
      heldCount: 0,
    });
    await expectCountersMatchGuests('evt-1');
  });

  it('is idempotent — a redelivered webhook does not double-count', async () => {
    await event({ heldCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'b@e.com',
      status: 'held',
    });
    await confirmHeldGuest('org-7', 'evt-1', 'b@e.com');

    const second = await confirmHeldGuest('org-7', 'evt-1', 'b@e.com');

    expect(second).toMatchObject({
      changed: false,
      reason: 'already-applied',
    });
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 1,
      heldCount: 0,
    });
  });

  it('refuses a guest who is not holding', async () => {
    await event({ pendingCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'q@e.com',
      status: 'pending',
    });

    expect(await confirmHeldGuest('org-7', 'evt-1', 'q@e.com')).toMatchObject({
      changed: false,
      reason: 'wrong-status',
    });
    await expectCountersMatchGuests('evt-1');
  });

  it('reports a missing guest instead of throwing', async () => {
    await event();

    expect(
      await confirmHeldGuest('org-7', 'evt-1', 'nobody@e.com'),
    ).toMatchObject({
      changed: false,
      guest: null,
      reason: 'not-found',
    });
  });

  it('throws when the event does not exist', async () => {
    await expect(
      confirmHeldGuest('org-7', 'evt-gone', 'a@e.com'),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('releaseHold', () => {
  it('expires the hold and gives the seat back', async () => {
    await event({ heldCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'lapsed@e.com',
      status: 'held',
      holdExpiresAt: at(30),
    });

    const result = await releaseHold('org-7', 'evt-1', 'lapsed@e.com');

    expect(result).toMatchObject({ changed: true });
    expect(result.guest).toMatchObject({ status: 'expired' });
    expect(result.guest?.holdExpiresAt).toBeUndefined();
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      heldCount: 0,
      confirmedCount: 0,
    });
    await expectCountersMatchGuests('evt-1');
  });

  it('is a no-op on an already-expired hold', async () => {
    await event();
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'x@e.com',
      status: 'expired',
    });

    expect(await releaseHold('org-7', 'evt-1', 'x@e.com')).toMatchObject({
      changed: false,
      reason: 'already-applied',
    });
  });

  it('will not expire a guest who already paid', async () => {
    await event({ confirmedCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'paid@e.com',
      status: 'confirmed',
    });

    expect(await releaseHold('org-7', 'evt-1', 'paid@e.com')).toMatchObject({
      changed: false,
      reason: 'wrong-status',
    });
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 1,
    });
  });
});

describe('cancelGuest', () => {
  // Whichever counter the guest was being counted by is the one that goes down
  // — decided from the status read inside the transaction, not from the caller.
  it.each([
    ['confirmed', { confirmedCount: 1, heldCount: 0, pendingCount: 0 }],
    ['held', { confirmedCount: 0, heldCount: 1, pendingCount: 0 }],
    ['pending', { confirmedCount: 0, heldCount: 0, pendingCount: 1 }],
  ] as const)(
    'releases the place a %s guest held',
    async (status, counters) => {
      await event(counters);
      await seedGuest({
        eventId: 'evt-1',
        orgId: 'org-7',
        email: 'go@e.com',
        status,
      });

      const result = await cancelGuest('org-7', 'evt-1', 'go@e.com');

      expect(result).toMatchObject({ changed: true });
      expect(result.guest).toMatchObject({ status: 'cancelled' });
      expect(result.guest?.cancelledAt).toBeDefined();
      expect(await getEvent('org-7', 'evt-1')).toMatchObject({
        confirmedCount: 0,
        heldCount: 0,
        pendingCount: 0,
      });
      await expectCountersMatchGuests('evt-1');
    },
  );

  it('drops the waitlist position when a queued guest leaves', async () => {
    await event({ pendingCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'q@e.com',
      status: 'pending',
      waitlistPosition: 4,
    });

    await cancelGuest('org-7', 'evt-1', 'q@e.com');

    expect(
      (await getGuest('org-7', 'evt-1', 'q@e.com'))?.waitlistPosition,
    ).toBeUndefined();
  });

  it('cancelling an already-cancelled guest is a no-op', async () => {
    await event({ confirmedCount: 1 });
    await seedGuest({ eventId: 'evt-1', orgId: 'org-7', email: 'twice@e.com' });
    await cancelGuest('org-7', 'evt-1', 'twice@e.com');

    const second = await cancelGuest('org-7', 'evt-1', 'twice@e.com');

    expect(second).toMatchObject({
      changed: false,
      reason: 'already-applied',
    });
    // The counter went down once, not twice, and never below zero.
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 0,
    });
  });

  it('reports a missing guest instead of throwing', async () => {
    await event();

    expect(await cancelGuest('org-7', 'evt-1', 'nobody@e.com')).toMatchObject({
      changed: false,
      guest: null,
      reason: 'not-found',
    });
  });

  it('leaves an expired hold alone — its seat was already released', async () => {
    await event();
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'x@e.com',
      status: 'expired',
    });

    expect(await cancelGuest('org-7', 'evt-1', 'x@e.com')).toMatchObject({
      changed: false,
      reason: 'wrong-status',
    });
    expect((await getGuest('org-7', 'evt-1', 'x@e.com'))?.status).toBe(
      'expired',
    );
  });
});

describe('promoteNextPending', () => {
  it('promotes the longest-waiting guest, not the lowest position number', async () => {
    await event({ maxGuests: 3, confirmedCount: 0, pendingCount: 3 });
    // Registration order deliberately disagrees with the stored positions:
    // `registeredAt` is what decides, and it is the only thing that should.
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'second@e.com',
      status: 'pending',
      registeredAt: at(2),
      waitlistPosition: 1,
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'first@e.com',
      status: 'pending',
      registeredAt: at(1),
      waitlistPosition: 9,
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'third@e.com',
      status: 'pending',
      registeredAt: at(3),
      waitlistPosition: 2,
    });

    const promoted = await promoteNextPending('org-7', 'evt-1');

    expect(promoted).toMatchObject({
      email: 'first@e.com',
      status: 'confirmed',
    });
    expect(promoted?.waitlistPosition).toBeUndefined();
    expect(promoted?.confirmedAt).toBeDefined();
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 1,
      pendingCount: 2,
    });
    await expectCountersMatchGuests('evt-1');
  });

  it('returns null when nobody is waiting', async () => {
    await event();

    expect(await promoteNextPending('org-7', 'evt-1')).toBeNull();
  });

  it('returns null rather than overselling a full event', async () => {
    await event({ maxGuests: 1, confirmedCount: 1, pendingCount: 1 });
    await seedGuest({ eventId: 'evt-1', orgId: 'org-7', email: 'taken@e.com' });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'waiting@e.com',
      status: 'pending',
      registeredAt: at(1),
    });

    expect(await promoteNextPending('org-7', 'evt-1')).toBeNull();
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 1,
      pendingCount: 1,
    });
  });

  it('counts an outstanding hold as an occupied seat', async () => {
    await event({ maxGuests: 1, heldCount: 1, pendingCount: 1 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'holder@e.com',
      status: 'held',
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'waiting@e.com',
      status: 'pending',
      registeredAt: at(1),
    });

    expect(await promoteNextPending('org-7', 'evt-1')).toBeNull();
  });

  it('throws when the event does not exist', async () => {
    await expect(
      promoteNextPending('org-7', 'evt-gone'),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('promoteNextPending under concurrency', () => {
  it('two simultaneous promotions take two different guests', async () => {
    await event({ maxGuests: 4, confirmedCount: 2, pendingCount: 2 });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'seated-a@e.com',
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'seated-b@e.com',
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'wait-1@e.com',
      status: 'pending',
      registeredAt: at(1),
    });
    await seedGuest({
      eventId: 'evt-1',
      orgId: 'org-7',
      email: 'wait-2@e.com',
      status: 'pending',
      registeredAt: at(2),
    });

    // Two cancellations landing together, each freeing a seat and pulling the
    // next guest in. The dangerous outcome is both promoting `wait-1`.
    const [left, right] = await Promise.all([
      cancelGuest('org-7', 'evt-1', 'seated-a@e.com').then(() =>
        promoteNextPending('org-7', 'evt-1'),
      ),
      cancelGuest('org-7', 'evt-1', 'seated-b@e.com').then(() =>
        promoteNextPending('org-7', 'evt-1'),
      ),
    ]);

    expect(new Set([left?.email, right?.email])).toEqual(
      new Set(['wait-1@e.com', 'wait-2@e.com']),
    );
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 2,
      pendingCount: 0,
    });
    await expectCountersMatchGuests('evt-1');
  }, 60_000);

  it('more promotions than waiting guests still promotes each of them once', async () => {
    await event({ maxGuests: 0, pendingCount: 3 });
    for (const index of [1, 2, 3]) {
      await seedGuest({
        eventId: 'evt-1',
        orgId: 'org-7',
        email: `wait-${index}@e.com`,
        status: 'pending',
        registeredAt: at(index),
      });
    }

    const promoted = await Promise.all(
      Array.from({ length: 6 }, () => promoteNextPending('org-7', 'evt-1')),
    );

    const emails = promoted.flatMap((guest) => (guest ? [guest.email] : []));
    expect(emails).toHaveLength(3);
    expect(new Set(emails).size).toBe(3);
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 3,
      pendingCount: 0,
    });
    await expectCountersMatchGuests('evt-1');
  }, 60_000);
});

describe('counter invariant across mixed transitions', () => {
  it('holds after every step of a full registration lifecycle', async () => {
    await event({ maxGuests: 2 });

    // A scripted run through every transition this library can perform, with
    // the invariant re-checked after each one. Each entry is one step.
    const register = (email: string, mode: 'confirm' | 'hold') => () =>
      reserveSpot(
        'org-7',
        'evt-1',
        { email, name: email[0].toUpperCase() },
        mode,
      );

    const steps: [string, () => Promise<unknown>][] = [
      ['a confirms', register('a@e.com', 'confirm')],
      ['b holds', register('b@e.com', 'hold')],
      // Full now: 1 confirmed + 1 held == maxGuests, so the next two queue.
      ['c is waitlisted', register('c@e.com', 'confirm')],
      ['d is waitlisted', register('d@e.com', 'confirm')],
      ['a re-registers (no-op)', register('a@e.com', 'confirm')],
      [
        "b's payment lands",
        () =>
          confirmHeldGuest('org-7', 'evt-1', 'b@e.com', { amountPaid: 100 }),
      ],
      ['a cancels', () => cancelGuest('org-7', 'evt-1', 'a@e.com')],
      ['c is promoted', () => promoteNextPending('org-7', 'evt-1')],
      ['b cancels', () => cancelGuest('org-7', 'evt-1', 'b@e.com')],
      ['d is promoted', () => promoteNextPending('org-7', 'evt-1')],
      ['nobody left to promote', () => promoteNextPending('org-7', 'evt-1')],
      [
        'c cancels, freeing a seat',
        () => cancelGuest('org-7', 'evt-1', 'c@e.com'),
      ],
      ['a comes back and holds it', register('a@e.com', 'hold')],
      ["a's hold lapses", () => releaseHold('org-7', 'evt-1', 'a@e.com')],
      [
        'cancelling lapsed a is a no-op',
        () => cancelGuest('org-7', 'evt-1', 'a@e.com'),
      ],
      ['a registers a third time', register('a@e.com', 'confirm')],
    ];

    for (const [label, step] of steps) {
      await step();
      await expectCountersMatchGuests('evt-1', label);
    }

    // And the end state is the one the script implies.
    expect(await getEvent('org-7', 'evt-1')).toMatchObject({
      confirmedCount: 2,
      heldCount: 0,
      pendingCount: 0,
    });
    const finalGuests = await listEventGuests('org-7', 'evt-1');
    expect(
      finalGuests
        .filter((guest) => guest.status === 'confirmed')
        .map((guest) => guest.email)
        .sort(),
    ).toEqual(['a@e.com', 'd@e.com']);
  }, 60_000);

  it('holds under a burst of interleaved registrations and cancellations', async () => {
    await event({ maxGuests: 5 });
    const emails = Array.from({ length: 20 }, (_, i) => `mix-${i}@e.com`);

    await Promise.all(
      emails.map((email, index) =>
        reserveSpot(
          'org-7',
          'evt-1',
          { email, name: 'M' },
          index % 3 === 0 ? 'hold' : 'confirm',
        ),
      ),
    );
    await expectCountersMatchGuests('evt-1');

    // Cancel every third registrant and promote off the waitlist for each,
    // all at once.
    await Promise.all(
      emails
        .filter((_, index) => index % 3 === 0)
        .map((email) =>
          cancelGuest('org-7', 'evt-1', email).then(() =>
            promoteNextPending('org-7', 'evt-1'),
          ),
        ),
    );

    await expectCountersMatchGuests('evt-1');
    const event1 = await getEvent('org-7', 'evt-1');
    // Never oversold, whatever order the burst resolved in.
    expect(
      (event1?.confirmedCount ?? 0) + (event1?.heldCount ?? 0),
    ).toBeLessThanOrEqual(5);
  }, 120_000);
});
