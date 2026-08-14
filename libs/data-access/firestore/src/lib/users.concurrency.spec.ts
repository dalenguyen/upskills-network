import type { User } from '@upskills/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { T0, seedUser } from '../testing/seed';
import { userRef } from './collections';
import { createUserIfAbsent } from './users';

/**
 * Issue #39 — the race `createUserIfAbsent` exists for.
 *
 * A read-then-write outside a transaction passes every test in `users.spec.ts`
 * and fails here: both racers read "no document", both create one, and the
 * second write wins. On a user document the field that loses is `role`, so the
 * bug's signature is an admin silently demoted by signing in on a second
 * device.
 *
 * ## Two racers, deliberately
 *
 * The property is mutual exclusion — exactly one creator — and that is either
 * true at two racers or it is not true at all; it does not become true at
 * twenty-five. Sign-in is also not a burst path: nobody signs in as the same
 * user twenty-five times at once. Sized to contend reliably rather than to be a
 * load test, so it does not compete with the registration suite for the one
 * emulator all of these share.
 */

const RACERS = 2;

const NEW_USER: User = {
  uid: 'uid-racer',
  email: 'racer@example.com',
  name: 'Racer',
  role: 'user',
  orgIds: [],
  createdAt: T0,
};

beforeEach(clearFirestore);

describe('createUserIfAbsent under concurrency', () => {
  it(`lets exactly one of ${RACERS} simultaneous first sign-ins create the document`, async () => {
    // Fired together: both calls are in flight before either commits, which is
    // the only way to reach the lost-update window.
    const results = await Promise.all(
      Array.from({ length: RACERS }, () => createUserIfAbsent(NEW_USER)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(
      RACERS - 1,
    );

    // Nobody was told about a document other than the one that exists.
    for (const result of results) {
      expect(result.user).toEqual(NEW_USER);
    }
  });

  it('does not demote an admin promoted between a racer’s read and its write', async () => {
    // The failure this protects against, staged as directly as the emulator
    // allows: an existing admin, and a sign-in that would write `role: "user"`
    // if it ever got to write at all.
    const admin = await seedUser({ uid: 'uid-racer', role: 'admin' });

    const results = await Promise.all(
      Array.from({ length: RACERS }, () => createUserIfAbsent(NEW_USER)),
    );

    expect(results.every((result) => !result.created)).toBe(true);
    expect((await userRef('uid-racer').get()).data()).toEqual(admin);
  });
});

/**
 * Deliberately not tested here: that the *loser* is handed the stored document
 * rather than its own candidate. It is the same property, and `users.spec.ts`
 * proves it deterministically — a second call with a different candidate gets
 * the seeded admin back. Re-proving it through a second live race would buy
 * nothing and would spend another few seconds of contention on the one emulator
 * every file in this lib shares.
 */
