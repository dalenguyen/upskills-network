import type { PlatformRole } from '@upskills/models';
import { getAdminAuth } from './admin-auth';

/**
 * Mirroring the `admin` platform role into a Firebase **custom claim**.
 *
 * ## Why a claim as well as a document
 *
 * `users/{uid}.role` stays the source of truth — it is what the admin UI reads
 * and what server code authorizes against. The claim exists for one consumer:
 * Firestore security rules. A rule that answers "is this an admin?" by calling
 * `get(/databases/$(database)/documents/users/$(uid))` pays a document read on
 * **every evaluation of every rule that mentions it**, including hot public
 * reads by users who are not admins and never will be. That is a billed read
 * and a latency hit per document scanned. `request.auth.token.admin == true` is
 * free and local to the token.
 *
 * The claim is therefore a cache, and the usual cache question applies: how
 * stale can it get, and what breaks while it is?
 *
 * ## Propagation: the claim takes effect on token refresh, not instantly
 *
 * `setCustomUserClaims` writes to the account, not to the tokens already out in
 * the world. A client's ID token carries the claims that were true when it was
 * minted, and the client SDK refreshes it about hourly — so a promotion can
 * take up to an hour to become visible to security rules, and a session cookie
 * minted before the change carries the old claim for its whole five days.
 *
 * For a **promotion** that lag is merely slow. For a **demotion** it is a hole:
 * a stripped admin would keep passing `request.auth.token.admin == true` until
 * their token happened to refresh. That is why {@link withAdminClaimMirrored}
 * revokes sessions on demotion by default — revocation is checked on every
 * verification, so it closes the window immediately at the cost of signing the
 * user out.
 *
 * There is no path by which a client can forge this claim: custom claims are
 * writable only through the Admin SDK, and `users/{uid}` is unwritable from the
 * client by rule, so a user cannot promote themselves in either place.
 */

/** The claim name security rules check. Changing it means changing the rules. */
export const ADMIN_CLAIM = 'admin';

/** Custom claims as Firebase stores them. */
export type CustomClaims = { [key: string]: unknown };

/** The slice of `Auth` this module needs. See `getAdminAuth`. */
export interface ClaimsAuth {
  getUser(uid: string): Promise<{ customClaims?: CustomClaims | undefined }>;
  setCustomUserClaims(
    uid: string,
    customUserClaims: object | null,
  ): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
}

export interface SyncAdminClaimOptions {
  /** Injected client. Tests pass a fake; production passes nothing. */
  auth?: ClaimsAuth;
}

export interface SyncAdminClaimResult {
  uid: string;
  /** Whether the account now carries the admin claim. */
  admin: boolean;
  /**
   * `false` when the claim already matched and nothing was written — the
   * signal that a re-run was a no-op.
   */
  changed: boolean;
  /** The full claim set now on the account. */
  claims: CustomClaims;
}

/**
 * Bring the `admin` custom claim in line with a platform role.
 *
 * Safe to call any number of times: it reads the account's current claims
 * first, and writes only when they disagree with `role`. That matters because
 * this sits behind an admin route that can be retried, double-clicked, or
 * replayed, and because a caller recovering from a partial failure should be
 * able to simply run it again.
 *
 * ## Merged, not replaced
 *
 * `setCustomUserClaims` overwrites the entire claim object — passing
 * `{ admin: true }` silently deletes every other custom claim on the account.
 * So the existing claims are read and spread, and only the `admin` key is
 * touched. Nothing else sets custom claims today, which is exactly why this
 * must not assume so: the first feature that adds one would otherwise be
 * erased by the next role change, at a distance, with no error.
 *
 * ## Demotion deletes the key rather than setting `false`
 *
 * `admin: false` would satisfy the rules (`== true` fails either way), but it
 * leaves every non-admin account carrying a claim, and it makes "was this ever
 * an admin?" indistinguishable from "is this an admin?" for anyone reading a
 * token. Absent means not an admin.
 */
export async function syncAdminClaim(
  uid: string,
  role: PlatformRole,
  options: SyncAdminClaimOptions = {},
): Promise<SyncAdminClaimResult> {
  const auth = options.auth ?? getAdminAuth();
  const shouldBeAdmin = role === 'admin';

  const existing: CustomClaims = (await auth.getUser(uid)).customClaims ?? {};
  const isAdmin = existing[ADMIN_CLAIM] === true;
  const hasKey = ADMIN_CLAIM in existing;

  // A stale `admin: false` left by an older writer still counts as a change:
  // the demoted state this library defines is "no key at all".
  if (shouldBeAdmin === isAdmin && shouldBeAdmin === hasKey) {
    return { uid, admin: isAdmin, changed: false, claims: existing };
  }

  const claims: CustomClaims = { ...existing };
  if (shouldBeAdmin) {
    claims[ADMIN_CLAIM] = true;
  } else {
    delete claims[ADMIN_CLAIM];
  }

  await auth.setCustomUserClaims(uid, claims);

  return { uid, admin: shouldBeAdmin, changed: true, claims };
}

export interface MirrorAdminClaimOptions extends SyncAdminClaimOptions {
  /**
   * Whether to invalidate the user's existing sessions afterwards.
   *
   * Defaults to `true` on demotion and `false` on promotion — see
   * {@link withAdminClaimMirrored}.
   */
  revokeSessions?: boolean;
}

export interface MirrorAdminClaimResult<T> {
  /** Whatever `writeRole` returned. */
  result: T;
  claim: SyncAdminClaimResult;
  sessionsRevoked: boolean;
}

/**
 * Change a user's platform role and mirror the claim around it, in the order
 * that fails safe.
 *
 * The caller supplies the Firestore write as `writeRole`; this owns the
 * sequencing. That split is why this is a callback and not two exported
 * functions the caller invokes in turn — the *order* is the part that is easy
 * to get wrong and impossible to notice, so it does not belong at the call
 * site:
 *
 * ```ts
 * await withAdminClaimMirrored(uid, role, () =>
 *   runIdempotentTransaction(async (transaction) => {
 *     const snapshot = await transaction.get(userRef(uid));
 *     if (!snapshot.exists) throw new UserNotFoundError(uid);
 *     transaction.update(userRef(uid), { role });
 *   }),
 * );
 * ```
 *
 * ## Why the order flips with the direction
 *
 * Firestore and Firebase Auth are two systems with no shared transaction, so
 * one of the two writes can land without the other. There is no ordering that
 * prevents that — only orderings that choose which half-applied state you get,
 * and the right choice is the one that leaves the *lower* privilege in force:
 *
 * - **Promotion** writes the document first and grants the claim second. A
 *   failure in between leaves a user who is an admin on paper but not yet in
 *   security rules — visible, harmless, fixed by re-running. The reverse would
 *   hand out a live admin claim backed by no record of the promotion.
 * - **Demotion** clears the claim first and writes the document second. A
 *   failure in between leaves an admin on paper whose rules-facing privilege is
 *   already gone. The reverse would leave a user the system calls an ordinary
 *   user while their token still says admin — the exact failure a demotion
 *   exists to prevent, and one nobody would think to look for.
 *
 * Both half-states converge on re-running the same call, which is what makes
 * "just try it again" a valid recovery.
 *
 * ## Why demotion revokes sessions
 *
 * Clearing the claim does not touch tokens already issued (see the module
 * comment). Left alone, a demoted admin keeps the claim until their client
 * refreshes — up to an hour for an ID token, up to the cookie's five days for a
 * session cookie. Revoking makes the next verification fail everywhere at once.
 * The cost is that the user is signed out, which is the correct outcome for
 * someone whose authority was just taken away, and the wrong one for a
 * promotion — so a promotion does not revoke unless asked. Pass
 * `revokeSessions` explicitly to override either default.
 */
export async function withAdminClaimMirrored<T>(
  uid: string,
  role: PlatformRole,
  writeRole: () => Promise<T>,
  options: MirrorAdminClaimOptions = {},
): Promise<MirrorAdminClaimResult<T>> {
  const auth = options.auth ?? getAdminAuth();
  const demotion = role !== 'admin';
  const revoke = options.revokeSessions ?? demotion;

  let claim = demotion ? await syncAdminClaim(uid, role, { auth }) : undefined;

  const result = await writeRole();

  claim ??= await syncAdminClaim(uid, role, { auth });

  if (revoke) {
    await auth.revokeRefreshTokens(uid);
  }

  return { result, claim, sessionsRevoked: revoke };
}
