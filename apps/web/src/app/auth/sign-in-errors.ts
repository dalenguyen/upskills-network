import { AuthUnavailableError, SessionExchangeError } from './auth-errors';

/**
 * Human-readable sign-in failures, chosen so no message confirms or denies
 * that a particular email address has an account.
 *
 * Firebase Auth reports several credential failures with distinct codes
 * (`auth/user-not-found`, `auth/wrong-password`, …). If a login page rendered
 * those separately it would hand an attacker an account-existence oracle. They
 * are therefore collapsed into one sentence. The same rule applies in reverse
 * on the register page: an `auth/email-already-in-use` refusal is phrased as
 * "we couldn't create that account", never "that address is already taken".
 */

const GENERIC_CREDENTIAL_MESSAGE =
  "That email and password don't match an account.";
const EMAIL_ALREADY_IN_USE_MESSAGE =
  "We couldn't create that account. Try signing in instead.";
const WEAK_PASSWORD_MESSAGE =
  'That password is too weak. Use at least 6 characters.';
const UNAVAILABLE_MESSAGE = 'Sign-in is unavailable right now.';
const RETRY_MESSAGE = 'Something went wrong. Try again.';
const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many attempts. Wait a moment and try again.';
const SIGN_IN_AGAIN_MESSAGE = 'Please sign in again.';
const POPUP_BLOCKED_MESSAGE =
  'Sign-in window was blocked. Allow pop-ups for this site and try again.';
const GOOGLE_DID_NOT_COMPLETE_MESSAGE =
  "Google sign-in didn't finish. Try again, or use your email and password.";
const EMAIL_HAS_PASSWORD_MESSAGE =
  'That email already has an account with a password. Sign in with your email instead.';
const GOOGLE_UNAVAILABLE_MESSAGE =
  "Google sign-in isn't available here. Use your email and password instead.";

/** Codes that must all read as the same account-neutral credential failure. */
const CREDENTIAL_FAILURE_CODES = new Set([
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-email',
  'auth/user-disabled',
]);

/**
 * Codes that say nothing about the credential.
 *
 * These must not fall through to {@link GENERIC_CREDENTIAL_MESSAGE}. A dropped
 * connection or a rate limit reported as "that email and password don't match"
 * sends someone to reset a password that was correct all along — the failure is
 * transient and the honest advice is to try again. Rate limiting is called out
 * separately because "try again" immediately is precisely the wrong move there.
 */
const TRANSIENT_FAILURE_CODES = new Set([
  'auth/network-request-failed',
  'auth/internal-error',
  'auth/timeout',
]);

/** Codes that mean the user closed the popup on purpose, not a failure. */
const NO_MESSAGE_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

/**
 * Codes that mean the sign-in popup never opened at all.
 *
 * The browser (or a browser like Arc that blocks pop-ups more aggressively than
 * most) refused to open the window. Blaming the credential is worse than
 * useless here — there is no credential, and "that email and password don't
 * match" sends the user hunting for a password that was never entered.
 */
const POPUP_FAILURE_CODES = new Set(['auth/popup-blocked']);

/**
 * The message to show for a failed sign-in attempt, or `null` when no message
 * should be shown at all (the user closed the Google popup).
 *
 * `flow` disambiguates the two kinds of attempt so a Google failure is never
 * phrased as a credential mismatch: a Google flow never asks for a password, so
 * "that email and password don't match" is nonsense advice for it — and, for an
 * unmapped error, it also hides the real cause (see the persistence-order note
 * in `firebase-auth-client.ts`).
 *
 * Reads Firebase's `code` off `unknown` rather than accepting a
 * `FirebaseError` here: pages should not need to import the Firebase type just
 * to report a failure, and an `instanceof` check against a third-party class
 * silently misses lookalike errors (and is exactly the trap the app's API
 * error readers already avoid).
 */
export type SignInFlow = 'password' | 'google';

export function signInErrorMessage(
  error: unknown,
  flow: SignInFlow = 'password',
): string | null {
  if (error instanceof AuthUnavailableError) {
    return UNAVAILABLE_MESSAGE;
  }

  if (error instanceof SessionExchangeError) {
    return error.retryable ? RETRY_MESSAGE : SIGN_IN_AGAIN_MESSAGE;
  }

  const code = signInErrorCode(error);

  if (code !== null && NO_MESSAGE_CODES.has(code)) {
    return null;
  }

  if (code !== null && POPUP_FAILURE_CODES.has(code)) {
    return POPUP_BLOCKED_MESSAGE;
  }

  if (code !== null && CREDENTIAL_FAILURE_CODES.has(code)) {
    return GENERIC_CREDENTIAL_MESSAGE;
  }

  if (code !== null && TRANSIENT_FAILURE_CODES.has(code)) {
    return RETRY_MESSAGE;
  }

  if (code === 'auth/too-many-requests') {
    return TOO_MANY_ATTEMPTS_MESSAGE;
  }

  if (code === 'auth/email-already-in-use') {
    return EMAIL_ALREADY_IN_USE_MESSAGE;
  }

  if (code === 'auth/weak-password') {
    return WEAK_PASSWORD_MESSAGE;
  }

  if (flow === 'google') {
    if (code === 'auth/account-exists-with-different-credential') {
      return EMAIL_HAS_PASSWORD_MESSAGE;
    }

    if (
      code === 'auth/unauthorized-domain' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      return GOOGLE_UNAVAILABLE_MESSAGE;
    }

    // An unmapped code — or none at all, e.g. the bare
    // `Error('Database is closing/hidden')` Arc throws from the IndexedDB
    // persistence layer — must not be reported as a credential mismatch: a
    // Google flow never asked for a password. Log it so the real code is
    // recoverable from the console without a breakpoint.
    console.warn('[auth] unmapped Google sign-in error', error);
    return GOOGLE_DID_NOT_COMPLETE_MESSAGE;
  }

  return GENERIC_CREDENTIAL_MESSAGE;
}

/**
 * Where an authenticated visitor belongs when nothing else says otherwise.
 *
 * Somebody who has just signed in, or who is already signed in and lands on
 * the sign-in page, asked for their workspace — not the marketing page. The
 * landing page is for visitors who are *not* signed in; sending an
 * authenticated user there leaves them to find the dashboard by hand, which is
 * the step that made signing in feel like it had not worked.
 */
export const POST_AUTH_LANDING = '/dashboard';

/**
 * The post-auth redirect target, read from the login/register query param.
 *
 * Only a same-origin relative path is accepted: exactly one leading `/`, and
 * not `//` or `/\`, which are protocol-relative and therefore can leave the
 * origin. Absolute URLs and `javascript:` fall through to `fallback`.
 *
 * `fallback` defaults to `/` so that a caller which has no opinion cannot
 * accidentally send a signed-out visitor somewhere guarded. Callers that only
 * run for an authenticated visitor pass {@link POST_AUTH_LANDING}.
 */
export function safeRedirectTarget(
  redirectTo: string | null,
  fallback = '/',
): string {
  if (
    typeof redirectTo === 'string' &&
    redirectTo.startsWith('/') &&
    !redirectTo.startsWith('//') &&
    !redirectTo.startsWith('/\\')
  ) {
    return redirectTo;
  }

  return fallback;
}

function signInErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}
