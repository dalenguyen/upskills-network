import type { Guest, Timestamp, WorkshopEvent } from '@upskills/models';

/**
 * Real `Guest` and `WorkshopEvent` values for the template tests.
 *
 * ## Why these are the real model types and not local shapes
 *
 * A template test is only worth anything if it renders what production will
 * render. Fixtures typed as `Guest` and `WorkshopEvent` mean a field that
 * changes in `@upskills/models` breaks these at compile time, which is the point
 * — the failure mode being guarded against is a template quietly reading a field
 * that no longer exists and printing `undefined` into a guest's inbox.
 *
 * ## Why the timestamps are plain objects
 *
 * `@upskills/models` declares `Timestamp` structurally — `toDate()` and
 * `toMillis()`, nothing more — precisely so nothing has to import the Admin SDK
 * to satisfy it. Honouring that here keeps `firebase-admin` out of this
 * library's dependency graph entirely, so the email tests need no emulator, no
 * credentials, and no `beforeAll`.
 */

/** A `Timestamp` for an ISO instant, without pulling in `firebase-admin`. */
export function timestampFor(iso: string): Timestamp {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`"${iso}" is not a date this fixture can use.`);
  }

  return {
    toDate: () => new Date(date),
    toMillis: () => date.getTime(),
  };
}

/**
 * A published, free, Toronto-time event.
 *
 * The zone is deliberately one with daylight saving and a non-zero offset: a
 * template that formats in UTC or in the server's zone renders a visibly
 * different hour against this fixture, which is exactly the bug the tests exist
 * to catch.
 */
export function eventFixture(
  overrides: Partial<WorkshopEvent> = {},
): WorkshopEvent {
  return {
    eventId: 'evt-typescript-101',
    orgId: 'org-upskills',
    createdBy: 'uid-1',
    title: 'TypeScript for Working Developers',
    slug: 'typescript-for-working-developers',
    description: 'A hands-on evening on the type system you already use.',
    startsAt: timestampFor('2026-09-03T22:30:00.000Z'),
    endsAt: timestampFor('2026-09-04T01:00:00.000Z'),
    timezone: 'America/Toronto',
    location: 'Ada Room, 250 University Ave, Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 30,
    confirmedCount: 12,
    heldCount: 0,
    pendingCount: 3,
    status: 'published',
    createdAt: timestampFor('2026-07-01T12:00:00.000Z'),
    updatedAt: timestampFor('2026-07-01T12:00:00.000Z'),
    ...overrides,
  };
}

/**
 * A confirmed guest of {@link eventFixture}.
 *
 * `guestId` is the normalized address and `email` keeps the casing the guest
 * typed — the real invariant, and the reason `cancelUrl` has to pick one of them
 * deliberately rather than by accident.
 */
export function guestFixture(overrides: Partial<Guest> = {}): Guest {
  return {
    guestId: 'priya.raman@example.com',
    eventId: 'evt-typescript-101',
    orgId: 'org-upskills',
    email: 'Priya.Raman@example.com',
    name: 'Priya Raman',
    status: 'confirmed',
    registeredAt: timestampFor('2026-08-01T15:04:00.000Z'),
    confirmedAt: timestampFor('2026-08-01T15:04:00.000Z'),
    cancelToken: 'H1nQ8wZ3rTgKpLm2vXbA9fJd',
    ...overrides,
  };
}

/** A paid, confirmed guest of a $25 event. */
export function paidGuestFixture(overrides: Partial<Guest> = {}): Guest {
  return guestFixture({
    amountPaid: 2500,
    stripeSessionId: 'cs_test_a1b2c3',
    stripePaymentIntentId: 'pi_3QxYz1AbCdEf',
    ...overrides,
  });
}

/** The paid counterpart of {@link eventFixture}. */
export function paidEventFixture(
  overrides: Partial<WorkshopEvent> = {},
): WorkshopEvent {
  return eventFixture({ price: 2500, ...overrides });
}
