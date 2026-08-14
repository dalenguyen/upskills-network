import type { AuthContext, MintedSession } from '@upskills/auth';
import {
  defineEventHandler,
  deleteCookie,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';

/**
 * `DELETE /api/v1/auth/session` — sign out.
 *
 * ## Both halves, or neither half works
 *
 * Clearing the cookie without revoking leaves the credential itself alive: a
 * copy lifted off the machine keeps authenticating for the rest of its five
 * days, and "sign out" did nothing but tidy the browser. Revoking without
 * clearing leaves the browser cheerfully sending a dead cookie and collecting
 * 401s until it expires. So this route revokes the refresh tokens *and* sends
 * the cleared `Set-Cookie`, in that order.
 *
 * ## Signing out without a valid session is a success, not a 401
 *
 * A caller whose cookie is already expired, revoked, or absent has nothing to
 * revoke — and answering 401 would refuse to clear the cookie, leaving a dead
 * credential in the browser and a client stuck in a sign-out loop it cannot
 * escape. Those cases clear the cookie and answer 200 with `revoked: false`.
 *
 * A revocation that *fails* is different: it is propagated, and the cookie is
 * left in place. Clearing it would report failure to the client while quietly
 * signing this browser out, hiding the fact that every other session — the one
 * the user is signing out to kill — is still live. Leaving everything as it was
 * makes the retry meaningful.
 */

export interface SessionDeleteResponse {
  /** `false` when there was no valid session to revoke. */
  revoked: boolean;
}

export interface SessionDeleteDeps {
  /** `requireAuth` from `@upskills/auth`. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `revokeSessions` from `@upskills/auth`. */
  revokeSessions(uid: string): Promise<void>;
  /** `clearedSessionCookie` from `@upskills/auth`. */
  clearedSessionCookie(): Omit<MintedSession, 'expiresIn'>;
}

export function createSessionDeleteHandler(
  deps: SessionDeleteDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    const uid = await signedInUid(event, deps);

    if (uid !== null) {
      // Not wrapped: a failure here must not be reported as a successful sign
      // out, and must not clear the cookie on its way past.
      await deps.revokeSessions(uid);
    }

    // Name and flags come from the lib. A deletion is matched on name, domain
    // and path, so a hand-spelled clear that forgets `path: '/'` leaves the
    // original cookie in place and the user apparently still signed in.
    const cleared = deps.clearedSessionCookie();
    deleteCookie(event, cleared.name, cleared.attributes);

    return { revoked: uid !== null } satisfies SessionDeleteResponse;
  });
}

/**
 * The caller's uid, or `null` when they have no usable session.
 *
 * Only a rejected credential is swallowed — the 401 family, which is exactly
 * the set of callers with nothing to revoke. Anything else (Firestore down, a
 * bug in the guard) still propagates, because "we could not tell who you are"
 * is not the same as "you are nobody", and reporting the second would answer
 * 200 to a sign-out that revoked nothing.
 */
async function signedInUid(
  event: H3Event,
  deps: SessionDeleteDeps,
): Promise<string | null> {
  try {
    return (await deps.requireAuth(event)).uid;
  } catch (error) {
    const mapped = toHttpError(error);
    const statusCode = (mapped as { statusCode?: unknown }).statusCode;

    if (statusCode === 401) {
      return null;
    }

    throw mapped;
  }
}
