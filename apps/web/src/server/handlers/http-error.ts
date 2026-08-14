import { createError, isError } from 'h3';

/**
 * The one place a thrown error becomes a status code.
 *
 * ## Why the error classes are matched by name and not with `instanceof`
 *
 * `InvalidSessionError` and `ForbiddenError` live in `@upskills/auth`, and that
 * package cannot be imported at runtime under Vitest — `firebase-admin/auth`
 * reaches `jwks-rsa`, which `require()`s `jose`, which ships ESM from a package
 * marked CommonJS (see `src/server/alias-smoke.spec.ts`). An `instanceof` check
 * needs the class as a *value*, so importing it here would make every handler
 * spec unloadable.
 *
 * Matching on `name` plus the numeric `status` the class carries is narrow
 * enough to be honest: both fields are part of those types' documented surface,
 * and nothing else in this app throws an `Error` named `InvalidSessionError`
 * with `status === 401`.
 *
 * ## Everything unrecognized stays a 500
 *
 * {@link toHttpError} returns the original error untouched when it recognizes
 * nothing, so Nitro answers 500. That is the same asymmetry `verifyOrReject`
 * argues for in the auth lib: a 500 on a request that was going to fail anyway
 * is loud and fixable, while quietly answering 401 signs a user out over a bug
 * they will hit again after signing back in, reported by nobody.
 */

/** The `data` payload on every error response these routes produce. */
export interface ApiErrorData {
  /** Stable machine-readable code for the client to branch on. */
  error: string;
  /**
   * For a 401 only: the auth lib's `SessionRejection`, which is how a client
   * tells `stale-sign-in` ("sign in again, immediately re-exchange") from
   * `expired` ("your session ran out") without parsing prose.
   */
  reason?: string;
}

interface ThrownAuthError {
  name: string;
  status: number;
  reason?: unknown;
}

function asAuthError(error: unknown): ThrownAuthError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const status = (error as unknown as { status?: unknown }).status;

  return typeof status === 'number'
    ? {
        name: error.name,
        status,
        reason: (error as { reason?: unknown }).reason,
      }
    : null;
}

/**
 * The error a route should throw, given the error it caught.
 *
 * - An `H3Error` (one a handler raised itself) passes through unchanged.
 * - `InvalidSessionError` → 401 carrying its `reason`.
 * - `ForbiddenError` → 403 with **no** detail: its message names roles and org
 *   ids for an operator's log, and echoing it would tell a caller about
 *   memberships they cannot see.
 * - Anything else is returned as-is, so it surfaces as a 500.
 */
export function toHttpError(error: unknown): unknown {
  if (isError(error)) {
    return error;
  }

  const authError = asAuthError(error);

  if (authError?.name === 'InvalidSessionError' && authError.status === 401) {
    return unauthorized(
      typeof authError.reason === 'string' ? authError.reason : 'malformed',
    );
  }

  if (authError?.name === 'ForbiddenError' && authError.status === 403) {
    return createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'You do not have access to this resource.',
      data: { error: 'forbidden' } satisfies ApiErrorData,
    });
  }

  return error;
}

/** A 401 naming why the credential was refused. */
export function unauthorized(reason: string) {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    message: 'Sign in again.',
    data: { error: 'invalid-session', reason } satisfies ApiErrorData,
  });
}

/** A 400 for a request body that is not shaped like the route's contract. */
export function badRequest(error: string, message: string) {
  return createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message,
    data: { error } satisfies ApiErrorData,
  });
}

/** A 404 for a resource the caller may see but which does not exist. */
export function notFound(error: string, message: string) {
  return createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message,
    data: { error } satisfies ApiErrorData,
  });
}
