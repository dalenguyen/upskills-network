import type { User } from '@upskills/models';
import { userRef } from './collections';
import { runTransaction } from './transactions';

/**
 * The one write path for `users/{uid}`.
 *
 * ## Why create-if-absent is a transaction
 *
 * The obvious shape is a read followed by a write: fetch the document, create
 * it if it is not there. That is the same lost update as counting guests before
 * taking a seat, and it has a victim. Two sign-ins landing together — a user
 * opening the app on a laptop and a phone at once — both read "no document" and
 * both write one, and the second write resets `role` to whatever the caller
 * passed. For an ordinary user that is invisible; for a promoted admin it is a
 * silent demotion that nobody notices until the day the privilege is needed.
 *
 * Reading the *missing* document inside the transaction is the whole mechanism,
 * exactly as in `slugs.ts`: the empty key joins the transaction's read set, so a
 * racer that creates it before the commit forces a retry rather than an
 * overwrite, and the retry re-reads and finds their document.
 *
 * ## Why {@link runTransaction} and not `runIdempotentTransaction`
 *
 * This is a create-once path. The idempotent variant restarts a *fresh*
 * transaction after the SDK's own attempts are exhausted, which re-runs the
 * body against a commit that may already have landed — the failure mode its own
 * doc comment describes, and which let two racers both believe they owned the
 * same slug. The restart budget would buy nothing here anyway: it exists for
 * sustained contention on one hot document, and `users/{uid}` is written only by
 * that one person's sign-ins. The SDK's in-transaction retries re-read and
 * cannot double-apply, which is precisely the property this needs.
 */

export interface CreateUserResult {
  /**
   * The stored document — the *existing* one when there was one, so a caller
   * that lost the race sees what actually persisted rather than what it asked
   * for.
   */
  user: User;
  /** `true` only when this call is what created the document. */
  created: boolean;
}

/**
 * Create `users/{uid}` if it does not exist, and return whatever is stored.
 *
 * An existing document wins in **every** field: this never updates, so it
 * cannot be used to change a role, an email, or anything else. What a new
 * document contains is the caller's decision — the platform-role default and
 * the rest of the sign-in policy live in the route that builds `user`, not
 * here.
 *
 * @param user the complete document to store if none exists. Its `uid` is the
 *   document id.
 */
export function createUserIfAbsent(user: User): Promise<CreateUserResult> {
  const ref = userRef(user.uid);

  return runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.data();

    if (existing) {
      // The path is authoritative for the id, as everywhere else in this lib.
      return { user: { ...existing, uid: snapshot.id }, created: false };
    }

    // `create`, never `set`: the read set is what serializes concurrent
    // sign-ins, and this is the backstop underneath it. If a document somehow
    // appears between the read and the commit, the write fails rather than
    // overwriting a live user — which for this collection means overwriting a
    // role.
    transaction.create(ref, user);

    return { user, created: true };
  });
}
