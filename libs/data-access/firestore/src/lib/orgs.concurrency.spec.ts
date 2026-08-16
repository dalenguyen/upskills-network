import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedUser } from '../testing/seed';
import { orgsCol, userRef } from './collections';
import { OrgLimitExceededError, createOrg } from './orgs';

/**
 * Issue #153 — the race the single-org check exists for.
 *
 * Two creates for the same user, fired together, must produce exactly one org.
 * Without the user-document read inside the transaction, both racers would see
 * "no org yet" and both build one. The check is serialized on `users/{uid}`:
 * both read it empty, both write their own org id, the losing write conflicts,
 * and on retry that transaction re-reads a populated `orgIds` and throws.
 *
 * ## Two racers, deliberately
 *
 * The property is mutual exclusion — exactly one creator — and that is either
 * true at two racers or it is not true at all; it does not become true at
 * twenty-five. Sized like `users.concurrency.spec.ts`, which this mirrors.
 */

const RACERS = 2;

/**
 * Same budget as the sibling concurrency specs: the loser is retried with
 * backoff until the winner commits, and how long that takes is the emulator's
 * business, not ours.
 */
const RACE_TIMEOUT_MS = 120_000;

beforeEach(clearFirestore);

describe('createOrg under concurrency', () => {
  it(
    `lets exactly one of ${RACERS} simultaneous creates give a user an org`,
    async () => {
      await seedUser({ uid: 'uid-racer', orgIds: [] });

      const results = await Promise.allSettled([
        createOrg({ name: 'Org A', slug: 'org-a', createdBy: 'uid-racer' }),
        createOrg({ name: 'Org B', slug: 'org-b', createdBy: 'uid-racer' }),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        OrgLimitExceededError,
      );

      // The one org that landed is the one the user document points at.
      const orgs = (await orgsCol().get()).docs;
      expect(orgs).toHaveLength(1);
      expect((await userRef('uid-racer').get()).data()?.orgIds).toEqual([
        orgs[0].id,
      ]);
    },
    RACE_TIMEOUT_MS,
  );
});
