import { normalizeEmail } from '@upskills/validation';

/**
 * The policy behind the one-off `users/{uid}.email` backfill.
 *
 * `users/{uid}.email` was stored exactly as the identity provider sent it, so
 * a mixed-case sign-in left a document that no normalized lookup can find. This
 * module owns the decision of *which* documents to rewrite; the executable
 * under `apps/web/scripts/` owns the Firestore walk and the single-field
 * update.
 *
 * Kept free of `@upskills/firestore` (and therefore `firebase-admin`) so the
 * `web-server` Vitest project can prove the behaviour without pulling the Admin
 * SDK into the test graph.
 */

/** A user document as far as this backfill cares. */
export interface BackfillUser {
  uid: string;
  email: string;
}

export interface BackfillUserEmailsDeps {
  /** Read every user document currently stored. */
  listUsers(): Promise<readonly BackfillUser[]>;
  /**
   * Rewrite just `email` on `users/{uid}`. Firestore's `update()` merges the
   * single field, so every other field — `role`, `orgIds`, `name`, and
   * `createdAt` — survives untouched.
   */
  rewriteEmail(uid: string, email: string): Promise<void>;
}

/**
 * Normalize mismatched `users/{uid}.email` fields in place.
 *
 * Idempotent: a document whose email already equals `normalizeEmail(email)` is
 * skipped, so a second run writes nothing. Only
 * {@link BackfillUserEmailsDeps.rewriteEmail} is ever called, so no other user
 * field can change here.
 *
 * @returns how many documents were rewritten.
 */
export async function backfillUserEmails(
  deps: BackfillUserEmailsDeps,
): Promise<number> {
  const users = await deps.listUsers();
  let rewritten = 0;

  for (const user of users) {
    const normalized = normalizeEmail(user.email);
    if (user.email === normalized) {
      continue;
    }

    await deps.rewriteEmail(user.uid, normalized);
    rewritten += 1;
  }

  return rewritten;
}
