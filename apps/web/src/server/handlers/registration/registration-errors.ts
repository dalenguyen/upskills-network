import { createError } from 'h3';
import type { ApiErrorData } from '../http-error';

/**
 * A 409 for a request that is well-formed and authorized but cannot be
 * satisfied in the resource's current state — an event that has been cancelled,
 * or one that needs a payment path this build does not have.
 *
 * Distinct from a 404 on purpose. A 409 tells the caller the thing exists and
 * something about it changed, which is only safe to say when they could already
 * see it. Anything the caller was never entitled to know about answers 404 —
 * see `register.ts` for where that line falls.
 */
export function conflict(error: string, message: string) {
  return createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    message,
    data: { error } satisfies ApiErrorData,
  });
}

/**
 * A 403 that says nothing beyond "no".
 *
 * Used for a cancellation whose token does not match. The message and code are
 * fixed, and identical whether the registration exists, was already cancelled,
 * or the token is simply wrong — see `cancel.ts`.
 */
export function forbidden(error: string, message: string) {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message,
    data: { error } satisfies ApiErrorData,
  });
}
