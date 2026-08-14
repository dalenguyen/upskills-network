import type { WorkshopEvent } from '@upskills/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { at, seedEvent, seedGuest } from '../testing/seed';
import { getEvent, getGuest, listEventGuests } from './reads';
import { reserveSpot } from './reserve-spot';
import { EventNotFoundError } from './transactions';

beforeEach(clearFirestore);

/** `reserveSpot` needs an event to reserve against; every test starts with one. */
const event = (overrides: Partial<WorkshopEvent> = {}) =>
  seedEvent({ eventId: 'evt-1', orgId: 'org-7', maxGuests: 2, ...overrides });

describe('reserveSpot — confirm mode', () => {
  it('takes a seat and increments confirmedCount', async () => {
    await event();

    const result = await reserveSpot(
      'evt-1',
      { email: 'Ada@Example.COM ', name: '  Ada  ' },
      'confirm',
    );

    expect(result).toMatchObject({
      outcome: 'confirmed',
      alreadyRegistered: false,
    });
    expect(result.guest).toMatchObject({
      guestId: 'ada@example.com',
      eventId: 'evt-1',
      // Copied off the event, so the guest doc is self-describing for the
      // collection-group lookup that never names the event.
      orgId: 'org-7',
      email: 'ada@example.com',
      name: 'Ada',
      status: 'confirmed',
    });
    expect(result.guest.cancelToken).toEqual(expect.any(String));
    expect(result.guest.confirmedAt).toBeDefined();

    // The doc id is the normalized email — raw input never reaches the path.
    expect(await getGuest('evt-1', 'ADA@example.com')).toMatchObject({
      guestId: 'ada@example.com',
      status: 'confirmed',
    });
    expect(await getEvent('evt-1')).toMatchObject({
      confirmedCount: 1,
      heldCount: 0,
      pendingCount: 0,
    });
  });

  it('waitlists once the confirmed seats are gone', async () => {
    await event({ maxGuests: 1 });
    await reserveSpot('evt-1', { email: 'first@e.com', name: 'A' }, 'confirm');

    const result = await reserveSpot(
      'evt-1',
      { email: 'second@e.com', name: 'B' },
      'confirm',
    );

    expect(result.outcome).toBe('waitlisted');
    expect(result.guest).toMatchObject({
      status: 'pending',
      waitlistPosition: 1,
    });
    expect(await getEvent('evt-1')).toMatchObject({
      confirmedCount: 1,
      pendingCount: 1,
    });
  });

  it('hands out contiguous waitlist positions', async () => {
    await event({ maxGuests: 1 });
    await reserveSpot('evt-1', { email: 'first@e.com', name: 'A' }, 'confirm');

    const positions: (number | undefined)[] = [];
    for (const email of ['b@e.com', 'c@e.com', 'd@e.com']) {
      const result = await reserveSpot(
        'evt-1',
        { email, name: 'X' },
        'confirm',
      );
      positions.push(result.guest.waitlistPosition);
    }

    expect(positions).toEqual([1, 2, 3]);
    expect(await getEvent('evt-1')).toMatchObject({ pendingCount: 3 });
  });

  it('counts holds against capacity — a seat mid-checkout is not available', async () => {
    await event({ maxGuests: 1 });
    await reserveSpot('evt-1', { email: 'holder@e.com', name: 'H' }, 'hold');

    const result = await reserveSpot(
      'evt-1',
      { email: 'late@e.com', name: 'L' },
      'confirm',
    );

    expect(result.outcome).toBe('waitlisted');
  });
});

describe('reserveSpot — hold mode', () => {
  it('reserves the seat and increments heldCount', async () => {
    await event();
    const holdExpiresAt = at(30);

    const result = await reserveSpot(
      'evt-1',
      {
        email: 'buyer@e.com',
        name: 'Buyer',
        holdExpiresAt,
        stripeSessionId: 'cs_test_1',
      },
      'hold',
    );

    expect(result.outcome).toBe('held');
    expect(result.guest).toMatchObject({
      status: 'held',
      stripeSessionId: 'cs_test_1',
    });
    expect(result.guest.holdExpiresAt?.toMillis()).toBe(
      holdExpiresAt.toMillis(),
    );
    // A hold is not a seat yet.
    expect(result.guest.confirmedAt).toBeUndefined();
    expect(await getEvent('evt-1')).toMatchObject({
      confirmedCount: 0,
      heldCount: 1,
    });
  });

  it('waitlists rather than holding when the event is full', async () => {
    await event({ maxGuests: 1, confirmedCount: 1 });

    const result = await reserveSpot(
      'evt-1',
      { email: 'buyer@e.com', name: 'Buyer' },
      'hold',
    );

    // No Stripe session should ever be created for this one.
    expect(result.outcome).toBe('waitlisted');
    expect(await getEvent('evt-1')).toMatchObject({
      heldCount: 0,
      pendingCount: 1,
    });
  });
});

describe('reserveSpot — unlimited capacity', () => {
  it('never waitlists when maxGuests is 0', async () => {
    await event({ maxGuests: 0 });

    const outcomes: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await reserveSpot(
        'evt-1',
        { email: `guest-${index}@e.com`, name: 'G' },
        'confirm',
      );
      outcomes.push(result.outcome);
    }

    expect(outcomes).toEqual(Array(5).fill('confirmed'));
    expect(await getEvent('evt-1')).toMatchObject({
      confirmedCount: 5,
      pendingCount: 0,
    });
  });
});

describe('reserveSpot — idempotency', () => {
  it('re-registering a confirmed guest is a no-op, not a duplicate', async () => {
    await event();
    const first = await reserveSpot(
      'evt-1',
      { email: 'ada@e.com', name: 'Ada' },
      'confirm',
    );

    const second = await reserveSpot(
      'evt-1',
      { email: ' ADA@e.com ', name: 'Ada Again' },
      'confirm',
    );

    expect(second).toMatchObject({
      outcome: 'confirmed',
      alreadyRegistered: true,
    });
    // The original document, untouched — including the cancel token already
    // sitting in their inbox.
    expect(second.guest.cancelToken).toBe(first.guest.cancelToken);
    expect(second.guest.name).toBe('Ada');
    expect(await listEventGuests('evt-1')).toHaveLength(1);
    expect(await getEvent('evt-1')).toMatchObject({ confirmedCount: 1 });
  });

  it('re-registering a held guest does not double-count the hold', async () => {
    await event();
    await reserveSpot('evt-1', { email: 'b@e.com', name: 'B' }, 'hold');

    const second = await reserveSpot(
      'evt-1',
      { email: 'b@e.com', name: 'B' },
      'hold',
    );

    expect(second).toMatchObject({ outcome: 'held', alreadyRegistered: true });
    expect(await getEvent('evt-1')).toMatchObject({ heldCount: 1 });
  });

  it('re-registering a waitlisted guest keeps their original position', async () => {
    await event({ maxGuests: 1, confirmedCount: 1, pendingCount: 3 });
    await seedGuest({
      eventId: 'evt-1',
      email: 'queued@e.com',
      status: 'pending',
      waitlistPosition: 3,
    });

    const result = await reserveSpot(
      'evt-1',
      { email: 'queued@e.com', name: 'Q' },
      'confirm',
    );

    expect(result).toMatchObject({
      outcome: 'waitlisted',
      alreadyRegistered: true,
    });
    expect(result.guest.waitlistPosition).toBe(3);
    // No second queue ticket.
    expect(await getEvent('evt-1')).toMatchObject({ pendingCount: 3 });
  });

  it('lets a cancelled guest register again as a fresh reservation', async () => {
    await event();
    await seedGuest({
      eventId: 'evt-1',
      email: 'back@e.com',
      status: 'cancelled',
      cancelledAt: at(5),
      cancelToken: 'old-token',
    });

    const result = await reserveSpot(
      'evt-1',
      { email: 'back@e.com', name: 'Back' },
      'confirm',
    );

    expect(result).toMatchObject({
      outcome: 'confirmed',
      alreadyRegistered: false,
    });
    expect(await getEvent('evt-1')).toMatchObject({ confirmedCount: 1 });

    // The full overwrite clears the residue of the previous registration.
    const stored = await getGuest('evt-1', 'back@e.com');
    expect(stored?.cancelledAt).toBeUndefined();
    expect(stored?.cancelToken).not.toBe('old-token');
  });

  it('lets a guest whose hold expired register again', async () => {
    await event();
    await seedGuest({
      eventId: 'evt-1',
      email: 'retry@e.com',
      status: 'expired',
      holdExpiresAt: at(-1),
    });

    const result = await reserveSpot(
      'evt-1',
      { email: 'retry@e.com', name: 'Retry' },
      'hold',
    );

    expect(result).toMatchObject({ outcome: 'held', alreadyRegistered: false });
    expect(await getEvent('evt-1')).toMatchObject({ heldCount: 1 });
  });
});

describe('reserveSpot — bad input', () => {
  it('throws EventNotFoundError rather than writing an orphan guest', async () => {
    await expect(
      reserveSpot('evt-missing', { email: 'a@e.com', name: 'A' }, 'confirm'),
    ).rejects.toBeInstanceOf(EventNotFoundError);

    expect(await listEventGuests('evt-missing')).toEqual([]);
  });
});
