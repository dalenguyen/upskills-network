import type { MintedSession, SessionUser } from '@upskills/auth';
import type { CreateUserResult } from '@upskills/firestore';
import type { PlatformRole } from '@upskills/models';
import { defineEventHandler, readBody, setCookie, type EventHandler } from 'h3';
import { badRequest, toHttpError } from '../http-error';
import type { SignInIdentity } from './user-upsert';

/**
 * `POST /api/v1/auth/session` — exchange a freshly minted ID token for a
 * session cookie, and create the caller's `users/{uid}` document if this is
 * their first sign-in.
 *
 * There is no `register` route by design (issue #39): the client SDK is the
 * only thing that creates Firebase accounts, and this route is the only thing
 * that creates user documents. Two account-creation paths drift, and then Auth
 * and Firestore disagree about who exists.
 *
 * ## The five-minute window is a feature, and the client must know it fired
 *
 * `createSessionCookie` refuses an ID token whose `auth_time` is more than five
 * minutes old, with `reason: 'stale-sign-in'`. A client that exchanges lazily
 * on some later page load will hit it, and the fix is to sign in again — not to
 * retry, which would fail identically forever. So it comes back as a 401 whose
 * body carries the reason, distinguishable from `expired` or `revoked`.
 *
 * ## Why the cookie is set last
 *
 * The response sets `Set-Cookie` only after the user document exists. Setting
 * it first and then failing the upsert would leave the browser holding a valid
 * session for a user `me.get` cannot find — signed in, and broken. Failing
 * before the cookie is set leaves the caller signed out, which is a state they
 * can recover from by signing in again.
 */

/** The route's request contract. */
export interface SessionPostBody {
  idToken: string;
}

/** What a successful exchange tells the client about itself. */
export interface SessionPostResponse {
  uid: string;
  role: PlatformRole;
  /** `true` when this exchange created the user document. */
  created: boolean;
}

export interface SessionPostDeps {
  /** `createSessionCookie` from `@upskills/auth`. */
  createSessionCookie(idToken: string): Promise<MintedSession>;
  /** `verifySessionCookie` from `@upskills/auth`. */
  verifySessionCookie(cookie: string): Promise<SessionUser>;
  upsertUser(identity: SignInIdentity): Promise<CreateUserResult>;
}

export function createSessionPostHandler(deps: SessionPostDeps): EventHandler {
  return defineEventHandler(async (event) => {
    const idToken = readIdToken(await readBody<unknown>(event));

    try {
      const minted = await deps.createSessionCookie(idToken);

      // The mint returns the cookie, not the identity behind it, so who the
      // caller is comes from verifying what was just minted. That is one extra
      // Auth round trip on the login path, and it buys the guarantee that the
      // uid written to Firestore is the uid the cookie actually authenticates
      // as — rather than a second, separately-decoded opinion of the ID token.
      const session = await deps.verifySessionCookie(minted.value);
      const identity = identityFrom(session);

      const { user, created } = await deps.upsertUser(identity);

      setCookie(event, minted.name, minted.value, minted.attributes);

      return { uid: user.uid, role: user.role, created } as SessionPostResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * The ID token out of the request body, or a 400.
 *
 * A body with no `idToken` at all is a malformed *request*, not a rejected
 * credential — nothing was presented to reject. `createSessionCookie` would
 * answer 401 `malformed` for it, which reads to a client as "sign in again"
 * when the real problem is that the client sent the wrong shape.
 */
function readIdToken(body: unknown): string {
  const idToken = (body as { idToken?: unknown } | null | undefined)?.idToken;

  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw badRequest(
      'invalid-body',
      'Expected a JSON body of the form { "idToken": "…" }.',
    );
  }

  return idToken;
}

/**
 * The identity to store, from the verified session.
 *
 * An account with no email address cannot be represented: `User.email` is
 * required, and it is what every guest-facing lookup in this app keys on.
 * Writing `''` instead would put a document with a meaningless email into the
 * collection and defer the failure to somewhere much harder to read. Every
 * sign-in method this app enables (email/password and Google) carries an email,
 * so this is a 400 for an account shape the product does not support, not a
 * path real users take.
 */
function identityFrom(session: SessionUser): SignInIdentity {
  if (session.email === undefined || session.email === '') {
    throw badRequest(
      'email-required',
      'This account has no email address; sign in with an email-bearing provider.',
    );
  }

  const name = session.claims['name'];

  return {
    uid: session.uid,
    email: session.email,
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
  };
}
