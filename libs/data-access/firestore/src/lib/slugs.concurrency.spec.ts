import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { eventSlugRef } from './collections';
import { SlugTakenError, eventSlugsOf, renameSlug, reserveSlug } from './slugs';

/**
 * Issue #34 — the race the reservation document exists for.
 *
 * A `where('slug', '==', …)` pre-check followed by a create passes every test
 * in `slugs.spec.ts` and fails here: all the racers query, all of them find
 * nothing, and all of them write. Two events then answer to `/events/{slug}`
 * and the second one is unreachable — with no error anywhere to notice.
 *
 * Nothing here is probabilistic. Exactly one caller is told yes, every other
 * caller gets a `SlugTakenError` (never a raw gRPC failure), and the single
 * document that exists names the caller that was told yes.
 */

/**
 * Racers.
 *
 * The property under test is mutual exclusion — *exactly one* winner — and that
 * is either true at two racers or it is not true at all; it does not become
 * true at twenty-five. Slug creation is also not a burst path in the way
 * registration is: nobody creates the same event slug twenty-five times at
 * once. So this is sized to contend reliably rather than to be a load test,
 * which keeps it from competing with the genuinely burst-shaped registration
 * suite for the one emulator all of these share.
 */
const RACERS = 10;

/** Real contention takes real time; generous so a slow machine fails honestly. */
const RACE_TIMEOUT_MS = 120_000;

beforeEach(clearFirestore);

describe('reserveSlug under concurrency', () => {
  it(
    `lets exactly one of ${RACERS} simultaneous creates take the slug`,
    async () => {
      const owners = Array.from(
        { length: RACERS },
        (_, index) => `evt-${index}`,
      );

      // Fired together: every call is in flight before any of them commits,
      // which is the only way to reach the lost-update window.
      const settled = await Promise.allSettled(
        owners.map((ownerId) =>
          reserveSlug(eventSlugsOf('org-1'), 'react-basics', ownerId),
        ),
      );

      const winners = settled.filter((result) => result.status === 'fulfilled');
      const losers = settled.filter((result) => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(RACERS - 1);

      const winnerIndex = settled.findIndex(
        (result) => result.status === 'fulfilled',
      );
      const winner = owners[winnerIndex];

      // Every loser got the typed 409 answer, not a leaked gRPC error — and it
      // names the winner, which is the read set doing the serializing: a loser
      // that had fallen through to the `create` backstop could only report
      // `unknown`, because it never re-read the document that beat it.
      for (const loser of losers) {
        expect(loser.reason).toBeInstanceOf(SlugTakenError);
        expect(loser.reason).toMatchObject({
          target: { kind: 'event', orgId: 'org-1' },
          slug: 'react-basics',
          heldBy: winner,
        });
      }

      // ...and the database agrees with whoever was told yes.
      const reservation = (
        await eventSlugRef('org-1', 'react-basics').get()
      ).data();
      expect(reservation).toEqual({ eventId: winner });
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'lets simultaneous creates of distinct slugs all succeed',
    async () => {
      // The flip side of the test above: distinct keys must not serialize into
      // each other, or every organizer publishing at once would 409 at random.
      const owners = Array.from(
        { length: RACERS },
        (_, index) => `evt-${index}`,
      );

      const slugs = await Promise.all(
        owners.map((ownerId) =>
          reserveSlug(eventSlugsOf('org-1'), `workshop-${ownerId}`, ownerId),
        ),
      );

      expect(new Set(slugs).size).toBe(RACERS);
      const stored = await Promise.all(
        slugs.map(async (slug) =>
          (await eventSlugRef('org-1', slug).get()).data(),
        ),
      );
      expect(stored).toEqual(owners.map((eventId) => ({ eventId })));
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'lets exactly one of many simultaneous renames land on the same target',
    async () => {
      const owners = Array.from(
        { length: RACERS },
        (_, index) => `evt-${index}`,
      );
      await Promise.all(
        owners.map((ownerId) =>
          reserveSlug(eventSlugsOf('org-1'), `before-${ownerId}`, ownerId),
        ),
      );

      const settled = await Promise.allSettled(
        owners.map((ownerId) =>
          renameSlug(eventSlugsOf('org-1'), ownerId, {
            from: `before-${ownerId}`,
            to: 'the-good-name',
          }),
        ),
      );

      const winnerIndex = settled.findIndex(
        (result) => result.status === 'fulfilled',
      );
      expect(
        settled.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      for (const loser of settled.filter(
        (result) => result.status === 'rejected',
      )) {
        expect(loser.reason).toBeInstanceOf(SlugTakenError);
      }

      const winner = owners[winnerIndex];
      expect(
        (await eventSlugRef('org-1', 'the-good-name').get()).data(),
      ).toEqual({
        eventId: winner,
      });

      // Both halves of the rename are one commit: the winner's old slug is
      // gone, and every loser still holds theirs.
      const remaining = await Promise.all(
        owners.map(async (ownerId) => ({
          ownerId,
          exists: (await eventSlugRef('org-1', `before-${ownerId}`).get())
            .exists,
        })),
      );
      expect(remaining.filter((entry) => !entry.exists)).toEqual([
        { ownerId: winner, exists: false },
      ]);
    },
    RACE_TIMEOUT_MS,
  );
});
