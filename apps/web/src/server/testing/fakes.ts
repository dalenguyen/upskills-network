import type { InvalidSessionError, SessionRejection } from '@upskills/auth';
import type { Timestamp } from '@upskills/models';

/**
 * Stand-ins for the two things a server-route spec cannot construct for real.
 *
 * `@upskills/auth` cannot be loaded at runtime under Vitest (see
 * `src/server/alias-smoke.spec.ts`), so its error classes have to be imitated.
 * They are imitated *typed*: the shape below is checked against the real
 * `InvalidSessionError` at compile time, so if `status` or `reason` ever moved,
 * `nx typecheck web` would fail rather than these specs quietly asserting
 * against a fiction.
 */

/** A `Timestamp` with the two methods the models declare, and nothing else. */
export function fakeTimestamp(date: Date): Timestamp {
  return { toDate: () => date, toMillis: () => date.getTime() };
}

/** An error indistinguishable from `InvalidSessionError` to a route. */
export function fakeInvalidSessionError(reason: SessionRejection): Error {
  const error = Object.assign(new Error(`Session refused: ${reason}.`), {
    name: 'InvalidSessionError',
    status: 401 as const,
    reason,
  }) satisfies Error & Pick<InvalidSessionError, 'status' | 'reason'>;

  return error;
}

/** An error indistinguishable from `ForbiddenError` to a route. */
export function fakeForbiddenError(message: string): Error {
  return Object.assign(new Error(message), {
    name: 'ForbiddenError',
    status: 403 as const,
  });
}
