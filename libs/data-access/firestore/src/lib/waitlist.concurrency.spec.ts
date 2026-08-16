import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { waitlistSubscribersCol } from './collections';
import { addWaitlistSubscriber } from './waitlist';

/**
 * The race `addWaitlistSubscriber` exists for.
 *
 * A read-then-write outside a transaction passes every test in
 * `waitlist.spec.ts` and fails here: both racers read "no document", both
 * create one, and the second write wins. Because the document id *is* the
 * normalized email, the bug's signature is not two rows — it is a subscriber's
 * `createdAt` being overwritten by the loser, with no way to tell which signup
 * won.
 */

const RACERS = 2;
const EMAIL = 'racer@example.com';

/**
 * Same reasoning as every other contention file here: the loser is retried with
 * backoff until the winner commits, and that duration belongs to the emulator.
 * Vitest's 5s default is close enough to bite — this test has been measured at
 * 3.9s on a loaded machine while passing.
 */
const RACE_TIMEOUT_MS = 120_000;

beforeEach(clearFirestore);

describe('addWaitlistSubscriber under concurrency', () => {
  it(
    `lets exactly one of ${RACERS} simultaneous signups create the document`,
    async () => {
      // Fired together: both calls are in flight before either commits, which is
      // the only way to reach the lost-update window.
      const results = await Promise.all(
        Array.from({ length: RACERS }, () => addWaitlistSubscriber(EMAIL)),
      );

      expect(
        results.filter((outcome) => outcome === 'subscribed'),
      ).toHaveLength(1);
      expect(
        results.filter((outcome) => outcome === 'already_subscribed'),
      ).toHaveLength(RACERS - 1);

      // Exactly one doc — the acceptance criterion that a read-then-write
      // implementation would fail by leaving the loser's write in place.
      const snapshot = await waitlistSubscribersCol().get();
      expect(snapshot.docs).toHaveLength(1);
      expect(snapshot.docs[0].id).toBe(EMAIL);
    },
    RACE_TIMEOUT_MS,
  );
});
