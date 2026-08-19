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

/**
 * The org write errors from `@upskills/firestore`, imitated the same way as
 * the auth errors above. Handler specs inject these rather than importing the
 * real classes, so the specs stay loadable without the Firestore SDK.
 */

/** An error indistinguishable from `SlugTakenError` to a route. */
export function fakeSlugTakenError(slug: string): Error {
  return Object.assign(new Error(`Slug "${slug}" is already taken.`), {
    name: 'SlugTakenError',
  });
}

/** An error indistinguishable from `InvalidSlugError` to a route. */
export function fakeInvalidSlugError(slug: string): Error {
  return Object.assign(new Error(`Slug "${slug}" is not usable.`), {
    name: 'InvalidSlugError',
  });
}

/** An error indistinguishable from `LastOrgAdminError` to a route. */
export function fakeLastOrgAdminError(orgId: string, uid: string): Error {
  return Object.assign(
    new Error(
      `Removing or demoting "${uid}" would leave org "${orgId}" with no admin.`,
    ),
    { name: 'LastOrgAdminError' },
  );
}

/** An error indistinguishable from `OrgNotFoundError` to a route. */
export function fakeOrgNotFoundError(orgId: string): Error {
  return Object.assign(new Error(`Organizer "${orgId}" does not exist.`), {
    name: 'OrgNotFoundError',
  });
}

/** An error indistinguishable from `OrgLimitExceededError` to a route. */
export function fakeOrgLimitExceededError(uid: string): Error {
  return Object.assign(
    new Error(`User "${uid}" already belongs to an organizer.`),
    { name: 'OrgLimitExceededError' },
  );
}

/** An error indistinguishable from `InviteNotFoundError` to a route. */
export function fakeInviteNotFoundError(inviteId: string): Error {
  return Object.assign(new Error(`Invitation "${inviteId}" does not exist.`), {
    name: 'InviteNotFoundError',
  });
}

/** An error indistinguishable from `InviteNotPendingError` to a route. */
export function fakeInviteNotPendingError(
  inviteId: string,
  status: string,
): Error {
  return Object.assign(new Error(`Invitation "${inviteId}" is ${status}.`), {
    name: 'InviteNotPendingError',
    status,
  });
}

/** An error indistinguishable from `InviteEmailMismatchError` to a route. */
export function fakeInviteEmailMismatchError(inviteId: string): Error {
  return Object.assign(
    new Error(`Invitation "${inviteId}" was not sent to this account.`),
    { name: 'InviteEmailMismatchError' },
  );
}
