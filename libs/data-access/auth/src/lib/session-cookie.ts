import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from './admin-auth';

/**
 * Firebase **session cookies** — the one authentication mechanism in this
 * application.
 *
 * ## Why not a bearer token
 *
 * Most of the dashboard is server-rendered, and authorization has to happen
 * *while* the page renders. There is no `Authorization` header on a document
 * request — the browser only sends one when JavaScript puts it there — so a
 * bearer-token design cannot authorize an SSR page at all. It would leave two
 * mechanisms in the codebase: a header for API routes and something else for
 * pages, each with its own idea of who the caller is. A cookie is sent on every
 * request of both kinds, so route handlers and page renders read the same
 * thing.
 *
 * A session cookie rather than the raw ID token, because an ID token lives for
 * one hour and cannot be revoked; a session cookie lives for days and *can* be
 * ({@link revokeSessions}), which is what makes "sign out everywhere" and
 * "demote this admin now" possible.
 *
 * ## The name is not a preference
 *
 * Cloud Run behind Firebase Hosting strips every cookie except one named
 * exactly `__session` before the request reaches the origin — a caching
 * constraint, not something configurable. A cookie named `session` or `auth`
 * works perfectly in local development and silently never arrives in
 * production. Hence {@link SESSION_COOKIE_NAME}, and hence
 * {@link createSessionCookie} returning the name alongside the value rather
 * than letting each call site spell it.
 */

/** The only cookie name that survives the Firebase Hosting → Cloud Run hop. */
export const SESSION_COOKIE_NAME = '__session';

/** Default session lifetime: five days, per the auth epic. */
export const DEFAULT_SESSION_LIFETIME_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Firebase's own floor and ceiling on a session cookie's life. Passing anything
 * outside this range makes `createSessionCookie` throw, so
 * {@link clampSessionLifetime} folds the caller's request into it instead of
 * letting a configuration typo become a runtime failure on the login path.
 */
export const MIN_SESSION_LIFETIME_MS = 5 * 60 * 1000;
export const MAX_SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * How stale a sign-in may be and still be exchangeable for a session cookie.
 *
 * See {@link createSessionCookie} for why this check exists at all.
 */
export const DEFAULT_MAX_AUTH_AGE_MS = 5 * 60 * 1000;

/**
 * The cookie flags every response must set, and the reason they are a constant
 * shape rather than four arguments at each call site.
 *
 * - `httpOnly` — script cannot read the cookie, so an XSS bug cannot exfiltrate
 *   a five-day credential.
 * - `secure` — never sent over plaintext. Unconditionally `true`, with no
 *   "relax it in development" branch: browsers treat `http://localhost` as a
 *   secure context and accept `Secure` cookies there, so the branch would buy
 *   nothing and would be exactly the flag someone leaves flipped in production.
 * - `sameSite: 'lax'` — the cookie rides top-level navigations (a link into the
 *   dashboard from an email renders signed in) but not cross-site form posts,
 *   which is the CSRF vector that matters for a cookie-authenticated mutation.
 *   `strict` would break the email links; `none` would defeat the point.
 * - `path: '/'` — SSR pages and `/api` routes both need it.
 */
export interface SessionCookieAttributes {
  httpOnly: true;
  secure: true;
  sameSite: 'lax';
  path: '/';
  /**
   * Cookie age in **seconds** — the unit `Set-Cookie` uses, and deliberately
   * not the milliseconds Firebase counts session lifetime in. Handing
   * `expiresIn` straight to a cookie helper is the bug this field exists to
   * prevent: it would mint a five-day session behind a cookie the browser drops
   * seven minutes later.
   */
  maxAge: number;
}

/** A freshly minted session cookie, ready to hand to a `Set-Cookie` helper. */
export interface MintedSession {
  /** Always {@link SESSION_COOKIE_NAME}. */
  name: string;
  /** The signed cookie value. */
  value: string;
  /** The lifetime Firebase actually minted it with, after clamping. */
  expiresIn: number;
  attributes: SessionCookieAttributes;
}

/** Who the caller is, as far as their session cookie proves. */
export interface SessionUser {
  uid: string;
  email?: string;
  /**
   * The mirrored `admin` custom claim — see `syncAdminClaim`.
   *
   * A snapshot taken when the cookie was minted, so it can lag a role change by
   * the life of the cookie. Server-side authorization reads the platform role
   * from `users/{uid}` for that reason; this is here for cheap checks and for
   * parity with what security rules will see.
   */
  admin: boolean;
  /** When this cookie stops being accepted. */
  expiresAt: Date;
  /** Everything Firebase decoded, for callers that need a specific claim. */
  claims: DecodedIdToken;
}

/** Why a session was refused. Every value maps to 401, never to 500. */
export type SessionRejection =
  /** No cookie on the request at all — an anonymous caller, not a failure. */
  | 'missing'
  /** Well-formed and genuine, but past its expiry. */
  | 'expired'
  /** {@link revokeSessions} ran after this cookie was minted. */
  | 'revoked'
  /** Not a Firebase session cookie: truncated, tampered with, or garbage. */
  | 'malformed'
  /** The account behind it has been disabled or deleted. */
  | 'disabled'
  /** The sign-in behind the ID token is too old to exchange for a session. */
  | 'stale-sign-in';

/**
 * Raised when a session cookie (or the ID token being exchanged for one) is not
 * acceptable.
 *
 * The point of this type is that a route can answer `401` on *any* of it
 * without inspecting Firebase error codes. An expired cookie is the single most
 * common request an authenticated app receives — every user hits it once a
 * session — and a raw Firebase throw escaping a route turns that ordinary
 * moment into a 500 and an alert page. The reason is carried along for logging
 * and for the rare caller that wants to distinguish "sign in again" from "your
 * account was disabled".
 */
export class InvalidSessionError extends Error {
  /** What a route should answer. Named so no handler has to remember. */
  readonly status = 401;

  constructor(
    readonly reason: SessionRejection,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InvalidSessionError';
  }
}

/** The slice of `Auth` needed to mint a cookie. See {@link getAdminAuth}. */
export interface MintingAuth {
  verifyIdToken(
    idToken: string,
    checkRevoked?: boolean,
  ): Promise<DecodedIdToken>;
  createSessionCookie(
    idToken: string,
    sessionCookieOptions: { expiresIn: number },
  ): Promise<string>;
}

/** The slice of `Auth` needed to verify a cookie. */
export interface VerifyingAuth {
  verifySessionCookie(
    sessionCookie: string,
    checkRevoked?: boolean,
  ): Promise<DecodedIdToken>;
}

/** The slice of `Auth` needed to revoke. */
export interface RevokingAuth {
  revokeRefreshTokens(uid: string): Promise<void>;
}

export interface CreateSessionCookieOptions {
  /** Requested lifetime in ms; clamped by {@link clampSessionLifetime}. */
  expiresIn?: number;
  /**
   * How old the sign-in behind the ID token may be. `0` disables the check —
   * see {@link createSessionCookie} for what that gives up.
   */
  maxAuthAgeMs?: number;
  /** Injected client. Tests pass a fake; production passes nothing. */
  auth?: MintingAuth;
}

/**
 * A session lifetime Firebase will accept.
 *
 * Clamping rather than throwing is deliberate: this runs on the login path, and
 * a misconfigured lifetime should degrade to a shorter (or longer) session, not
 * lock everyone out. A non-finite value — an unset env var parsed with
 * `Number()` is the usual source — is not clamped to some accidental bound but
 * replaced with the default, because `NaN` carries no intent to honor.
 */
export function clampSessionLifetime(expiresIn?: number): number {
  if (expiresIn === undefined || !Number.isFinite(expiresIn)) {
    return DEFAULT_SESSION_LIFETIME_MS;
  }

  return Math.min(
    MAX_SESSION_LIFETIME_MS,
    Math.max(MIN_SESSION_LIFETIME_MS, expiresIn),
  );
}

/**
 * Exchange a freshly minted ID token for a session cookie.
 *
 * ## Why the ID token is verified first
 *
 * `createSessionCookie` on its own would happily accept any unexpired ID token
 * for this project, and that is a longer reach than it looks. An ID token is
 * valid for an hour and is handed to any code the page runs; a copy of one
 * lifted from a compromised device would otherwise be upgradable into a
 * five-day session — a genuine escalation of both duration and revocability.
 * Two checks close that:
 *
 * - `verifyIdToken(token, true)` with revocation checking, so a token issued
 *   before a {@link revokeSessions} call cannot mint a session that outlives
 *   the revocation. Without the `true` this call is offline signature
 *   verification and a revoked user could quietly mint a fresh session.
 * - `auth_time` within {@link DEFAULT_MAX_AUTH_AGE_MS}, which is Firebase's own
 *   recommendation for this endpoint. `auth_time` records the actual sign-in,
 *   not the hourly refresh, so it cannot be reset by asking for a new token —
 *   only by signing in again.
 *
 * The practical consequence, and the thing to remember when wiring the client:
 * the exchange must happen **immediately after sign-in**, not lazily on some
 * later page load. A client that calls this an hour into a session gets
 * `stale-sign-in` and has to re-authenticate. Pass `maxAuthAgeMs: 0` to opt out
 * for a flow where that is genuinely wrong.
 *
 * ## Failures
 *
 * A rejection Firebase names as a verdict on the token becomes an
 * {@link InvalidSessionError} — a bad token is a 401, not a server fault.
 * Anything else is rethrown untouched so it stays a 500; see `verifyOrReject`
 * for why that is the safe direction to guess in.
 */
export async function createSessionCookie(
  idToken: string,
  options: CreateSessionCookieOptions = {},
): Promise<MintedSession> {
  const auth = options.auth ?? getAdminAuth();
  const expiresIn = clampSessionLifetime(options.expiresIn);
  const maxAuthAgeMs = options.maxAuthAgeMs ?? DEFAULT_MAX_AUTH_AGE_MS;

  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw new InvalidSessionError(
      'malformed',
      'No ID token was supplied to exchange for a session cookie.',
    );
  }

  const decoded = await verifyOrReject(() => auth.verifyIdToken(idToken, true));

  if (maxAuthAgeMs > 0) {
    // `auth_time` is in seconds since the epoch, like every other JWT claim.
    const authAgeMs = Date.now() - decoded.auth_time * 1000;
    if (authAgeMs > maxAuthAgeMs) {
      throw new InvalidSessionError(
        'stale-sign-in',
        `Sign-in happened ${Math.round(authAgeMs / 1000)}s ago; a session cookie may only be minted within ${Math.round(maxAuthAgeMs / 1000)}s of signing in.`,
      );
    }
  }

  const value = await verifyOrReject(() =>
    auth.createSessionCookie(idToken, { expiresIn }),
  );

  return {
    name: SESSION_COOKIE_NAME,
    value,
    expiresIn,
    attributes: sessionCookieAttributes(Math.floor(expiresIn / 1000)),
  };
}

export interface VerifySessionCookieOptions {
  auth?: VerifyingAuth;
}

/**
 * Decide who a request's session cookie says the caller is.
 *
 * ## Revocation is always checked
 *
 * The `true` passed to `verifySessionCookie` is not optional here and there is
 * no option to turn it off. Without it, verification is a local signature and
 * expiry check: a cookie minted before a revocation stays valid for its full
 * five days, so "sign out on my other devices", "this laptop was stolen" and
 * "this admin was demoted" would all do nothing until the cookie aged out. With
 * it, every request costs a lookup of the user's `tokensValidAfterTime` — and
 * that cost is precisely what buys revocation.
 *
 * Note the one gap Firebase leaves: revocation is recorded to the second, so a
 * cookie minted in the same second as the revoking call can survive it. It is
 * not a hazard worth engineering around here — it takes a sign-in racing a
 * revocation inside one second — but it is why "revoked" is not literally
 * instantaneous.
 *
 * ## Missing is a rejection, not an exception
 *
 * An absent cookie throws {@link InvalidSessionError} with reason `missing`
 * rather than returning `null`, so a guard cannot forget to handle the
 * anonymous case: there is exactly one way out of this function with a
 * `SessionUser` in hand.
 */
export async function verifySessionCookie(
  cookie: string | undefined | null,
  options: VerifySessionCookieOptions = {},
): Promise<SessionUser> {
  if (typeof cookie !== 'string' || cookie.trim() === '') {
    throw new InvalidSessionError('missing', 'No session cookie was sent.');
  }

  const auth = options.auth ?? getAdminAuth();
  const claims = await verifyOrReject(() =>
    auth.verifySessionCookie(cookie, true),
  );

  return {
    uid: claims.uid,
    ...(claims.email === undefined ? {} : { email: claims.email }),
    admin: claims['admin'] === true,
    expiresAt: new Date(claims.exp * 1000),
    claims,
  };
}

export interface RevokeSessionsOptions {
  auth?: RevokingAuth;
}

/**
 * Invalidate every session and refresh token the user currently holds.
 *
 * This is what sign-out-everywhere, a compromised account, and a demotion all
 * reduce to. It works by stamping `tokensValidAfterTime` on the account, which
 * is only consulted when a token is verified *with* revocation checking — so it
 * takes effect on the next request precisely because
 * {@link verifySessionCookie} always passes `true`.
 *
 * What it does **not** do is clear the browser's cookie; the caller still has to
 * send back a cleared `Set-Cookie` (see {@link clearedSessionCookie}), or the
 * user keeps sending a dead cookie and getting 401s. And an already-issued ID
 * token held by the *client* SDK keeps working against Firestore rules for up to
 * an hour, since rules do not check revocation — one more reason the browser is
 * never trusted to write.
 */
export async function revokeSessions(
  uid: string,
  options: RevokeSessionsOptions = {},
): Promise<void> {
  const auth = options.auth ?? getAdminAuth();
  await auth.revokeRefreshTokens(uid);
}

/**
 * The `Set-Cookie` shape that deletes the session cookie.
 *
 * The flags are repeated rather than omitted on purpose: a browser matches a
 * deletion against name, domain and **path**, so clearing `__session` without
 * `path: '/'` leaves the original cookie in place and the user apparently
 * signed in after signing out.
 */
export function clearedSessionCookie(): Omit<MintedSession, 'expiresIn'> {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    attributes: sessionCookieAttributes(0),
  };
}

function sessionCookieAttributes(maxAge: number): SessionCookieAttributes {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge };
}

/**
 * Firebase error codes that are a verdict on the credential — the complete
 * allow-list of failures that become a 401.
 *
 * An allow-list rather than a deny-list of "infrastructure" codes, because a
 * deny-list can only name the failures it anticipated. The dangerous errors are
 * the ones nobody labelled: a `TypeError` from a bug in this module, an
 * injected `auth` that is undefined, a parse failure inside the SDK, a socket
 * error that arrives with no `code` at all. Under a deny-list every one of
 * those reads as "your credential is bad, sign in again" — which is the silent
 * mass sign-out this module is otherwise careful to avoid, entering through the
 * back door.
 */
const REJECTION_BY_CODE: Record<string, SessionRejection> = {
  'auth/session-cookie-expired': 'expired',
  'auth/id-token-expired': 'expired',
  'auth/session-cookie-revoked': 'revoked',
  'auth/id-token-revoked': 'revoked',
  'auth/argument-error': 'malformed',
  'auth/invalid-session-cookie': 'malformed',
  'auth/invalid-id-token': 'malformed',
  'auth/user-disabled': 'disabled',
  'auth/user-not-found': 'disabled',
};

/**
 * Run a Firebase Auth verification and translate its failures.
 *
 * Exactly one rule: a failure becomes a 401 when Firebase names it as a verdict
 * on the credential, and **everything else is rethrown untouched**. Nothing is
 * inferred from the shape of the error, and there is no fall-through.
 *
 * The asymmetry is deliberate. Rethrowing an unrecognized failure costs a 500
 * on a request that was going to fail anyway — loud, attributable, fixable by
 * adding a code to the table above. Swallowing one costs a signed-out user who
 * will sign in again and hit the same bug, reported by nobody, indistinguishable
 * from an ordinary expiry in the logs. An outage that manifests as "every user
 * must sign in again" is far more expensive than one that manifests as 500s.
 *
 * That includes a new `auth/*` code Firebase might add for a token rejection:
 * it will surface as a 500 until someone adds it here. That is the intended
 * trade — a missing entry should be a visible bug, not a silent behavior.
 */
async function verifyOrReject<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const reason =
      typeof code === 'string' ? REJECTION_BY_CODE[code] : undefined;

    if (reason === undefined) {
      throw error;
    }

    const message = (error as { message?: string } | null)?.message;

    throw new InvalidSessionError(
      reason,
      message ?? `Firebase rejected the credential (${code}).`,
      error,
    );
  }
}
