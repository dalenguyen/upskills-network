import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent } from '../testing/seed';
import { getEvent, listEventGuests } from './reads';
import { reserveSpot } from './reserve-spot';

/**
 * Issue #36 — the test the whole capacity design exists for.
 *
 * Written before `reserveSpot`, and deliberately so: a "count the guests, then
 * create one if there's room" implementation passes every single-threaded test
 * in `reserve-spot.spec.ts` and fails only here. Both racers read
 * `confirmedCount: 0`, both see room, both write, and the event oversells one
 * seat with a counter that no longer matches its guests.
 *
 * Nothing about the assertions is probabilistic: after the dust settles there is
 * exactly one confirmed guest, the counter says `1`, and the losers hold a
 * contiguous 1..N−1 block of waitlist positions with no duplicates. Either the
 * capacity decision happened inside a transaction or one of those is false.
 */

/** Racers. Well above the ≥ 20 the issue asks for, to leave no slack. */
const RACERS = 25;

/**
 * Real transaction contention on one document takes real time: the losers are
 * retried with backoff until the winner commits. Well beyond what it actually
 * needs, so a slow machine reports a failure rather than a timeout.
 */
const RACE_TIMEOUT_MS = 120_000;

beforeEach(clearFirestore);

describe('reserveSpot under concurrency', () => {
  it(
    `lets exactly one of ${RACERS} simultaneous registrations take the only seat`,
    async () => {
      await seedEvent({ eventId: 'evt-race', maxGuests: 1 });

      const emails = Array.from(
        { length: RACERS },
        (_, index) => `racer-${index}@example.com`,
      );

      // Fired together, resolved together: every call is in flight before any
      // of them commits, which is the only way to reach the lost-update window.
      const results = await Promise.all(
        emails.map((email) =>
          reserveSpot('evt-race', { email, name: `Racer ${email}` }, 'confirm'),
        ),
      );

      const outcomes = results.map((result) => result.outcome);
      expect(
        outcomes.filter((outcome) => outcome === 'confirmed'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome === 'waitlisted'),
      ).toHaveLength(RACERS - 1);

      // ...and the database agrees with what the callers were told.
      const guests = await listEventGuests('evt-race');
      expect(guests).toHaveLength(RACERS);

      const confirmed = guests.filter((guest) => guest.status === 'confirmed');
      const pending = guests.filter((guest) => guest.status === 'pending');
      expect(confirmed).toHaveLength(1);
      expect(pending).toHaveLength(RACERS - 1);

      const event = await getEvent('evt-race');
      expect(event).toMatchObject({
        confirmedCount: 1,
        heldCount: 0,
        pendingCount: RACERS - 1,
      });

      // Distinct *and* contiguous: 1..N−1 with nothing repeated and no gaps.
      // A duplicate position is the counter having been read twice before
      // either write landed — the same lost update, seen from the waitlist.
      const positions = pending
        .map((guest) => guest.waitlistPosition)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(positions).toEqual(
        Array.from({ length: RACERS - 1 }, (_, index) => index + 1),
      );

      // Nobody was served twice, and nobody was dropped.
      expect(new Set(guests.map((guest) => guest.guestId)).size).toBe(RACERS);
      expect(new Set(guests.map((guest) => guest.email))).toEqual(
        new Set(emails),
      );
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'never oversells when the same racers include repeat registrations',
    async () => {
      await seedEvent({ eventId: 'evt-race-2', maxGuests: 1 });

      // Every email appears twice, so half the calls are re-registrations of a
      // guest another in-flight call may not have written yet.
      const emails = Array.from(
        { length: RACERS },
        (_, index) => `dup-${index % (RACERS / 2 + 1)}@example.com`,
      );

      await Promise.all(
        emails.map((email) =>
          reserveSpot('evt-race-2', { email, name: 'Dup' }, 'confirm'),
        ),
      );

      const guests = await listEventGuests('evt-race-2');
      const event = await getEvent('evt-race-2');

      // One doc per distinct email — the doc id is the normalized email, so a
      // duplicate registration overwrites rather than multiplying.
      expect(guests).toHaveLength(new Set(emails).size);
      expect(event?.confirmedCount).toBe(
        guests.filter((guest) => guest.status === 'confirmed').length,
      );
      expect(event?.pendingCount).toBe(
        guests.filter((guest) => guest.status === 'pending').length,
      );
      expect(event?.confirmedCount).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );
});
