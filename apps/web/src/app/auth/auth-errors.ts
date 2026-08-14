/**
 * Why a session could not be established, as the browser sees it.
 *
 * ## Why this union is duplicated rather than imported
 *
 * The server's `SessionRejection` lives in `@upskills/auth`, which wraps
 * `firebase-admin`. Importing it here — even `import type` — puts a
 * server-only module in the import graph of a browser bundle, and a later
 * refactor that turns the type import into a value import would ship the Admin
 * SDK to the client. Six string literals are cheap; the coupling is not.
 *
 * The full set the routes emit, `missing` included. It cannot arise from an
 * exchange — that request carries no cookie to be missing — but listing it
 * costs nothing and means a reason the server named never arrives here as
 * "unrecognised", which would read as a parsing bug rather than as data.
 */
export type SessionRejectionReason =
  | 'stale-sign-in'
  | 'expired'
  | 'revoked'
  | 'missing'
  | 'malformed'
  | 'disabled';

/**
 * Raised when the session exchange or teardown was refused by the server.
 *
 * The invariant the callers rely on: by the time this is thrown, the client has
 * already been signed out. There is no state in which this error has been
 * raised and the app still believes it holds a session.
 */
export class SessionExchangeError extends Error {
  constructor(
    /** HTTP status, or `0` when the request never reached the server. */
    readonly status: number,
    /** The server's reason, when it named one it can be matched against. */
    readonly reason: SessionRejectionReason | undefined,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SessionExchangeError';
  }

  /**
   * Whether sending the same request again could plausibly succeed.
   *
   * ## Why this is a property and not a judgement each call site makes
   *
   * `stale-sign-in` is the reason that punishes a guess. It means the ID token's
   * `auth_time` was already outside the server's five-minute window, and a
   * token refresh does not move `auth_time` — so a retry with a fresh token
   * fails identically, forever. A login page that treats "auth failed" as a
   * generic retry turns that into an infinite loop against a user who simply
   * needs to sign in again. The same holds for the 400s (`invalid-body`,
   * `email-required`): a malformed request and an account with no email claim
   * are not conditions that pass on their own.
   *
   * So the rule is the whole 4xx family, not a list of reasons — every refusal
   * the server can *name* is a verdict about this attempt, and no amount of
   * repeating it changes the verdict. Only a transport failure (`status === 0`)
   * or a 5xx is worth another go: those say nothing about the credential, which
   * is exactly why the server keeps them opaque.
   *
   * Note this is about *this request*, not about recovery. Nothing here is
   * retryable in the sense of "carry on as if signed in" — the client is signed
   * out before this throws either way. A false value means: send the user back
   * through sign-in. A true value means: the button may be pressed again.
   */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Raised when a sign-in method is called where there is no Firebase client.
 *
 * That is either a server-side render — where sign-in is meaningless, since
 * authorization comes from the `__session` cookie — or a build whose
 * `VITE_FIREBASE_*` variables are unset. Both are configuration facts, not
 * credential failures, so they are a distinct type: a login page should show
 * "sign-in is unavailable", not "wrong password".
 */
export class AuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

/**
 * Pull a rejection reason out of whatever the server sent.
 *
 * The shape that matters is the one the routes actually produce. Nitro
 * serialises h3's `createError({ data })` to:
 *
 * ```json
 * { "error": true, "url": "…", "statusCode": 401, "statusMessage": "…",
 *   "message": "Sign in again.",
 *   "data": { "error": "invalid-session", "reason": "stale-sign-in" } }
 * ```
 *
 * Two fields are named `error` and they are unrelated: the top-level one is
 * Nitro's own boolean `true`, and the route's is nested inside `data`. `data`
 * is therefore checked **first**, so the envelope can never shadow the payload.
 * (A boolean is not a reason and not an object, so the top-level field falls
 * through harmlessly either way — but the ordering is what makes that true by
 * construction rather than by luck.)
 *
 * The other envelopes — `{ reason }`, `{ error: { reason } }`,
 * `{ error: 'stale-sign-in' }` — are accepted too, deliberately. Not every
 * error on this path comes from a handler: a proxy, a Cloud Run cold start or
 * an offline browser can all answer instead, and none of them owes us a shape.
 * The reason only *phrases* a message; the decision to sign out and throw is
 * made from the failure itself. An unrecognised body yields `undefined` and a
 * generic message, never a crash on the failure path.
 */
export function sessionRejectionReasonFrom(
  body: unknown,
): SessionRejectionReason | undefined {
  if (typeof body !== 'object' || body === null) {
    return isRejectionReason(body) ? body : undefined;
  }

  const record = body as Record<string, unknown>;
  const candidates = [record['data'], record['reason'], record['error']];

  for (const candidate of candidates) {
    if (isRejectionReason(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'object' && candidate !== null) {
      const nested = (candidate as Record<string, unknown>)['reason'];
      if (isRejectionReason(nested)) {
        return nested;
      }
    }
  }

  return undefined;
}

const REJECTION_REASONS: readonly string[] = [
  'stale-sign-in',
  'expired',
  'revoked',
  'missing',
  'malformed',
  'disabled',
];

function isRejectionReason(value: unknown): value is SessionRejectionReason {
  return typeof value === 'string' && REJECTION_REASONS.includes(value);
}
