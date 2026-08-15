import type { CreateUserResult } from '@upskills/firestore';
import type { PlatformRole, Timestamp, User } from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';

/**
 * What a first sign-in writes to `users/{uid}`.
 *
 * This module owns the *policy*; the write itself is `createUserIfAbsent` in
 * `@upskills/firestore`, which owns the transaction that makes it safe. The
 * split is deliberate: "a new account is a `user` with no orgs" is a product
 * decision that belongs next to the route, and "create-if-absent must not lose
 * an update" is a data-access concern that belongs next to the emulator that
 * can prove it.
 *
 * ## Why a later sign-in writes nothing at all
 *
 * Not "writes everything except `role`" — writes *nothing*. The candidate below
 * is built on every exchange and discarded on all but the first. The only
 * fields a later sign-in could refresh are `email` and `name`, and refreshing
 * them costs a document write on every login, on the login path, to overwrite a
 * profile the user may have edited with whatever their identity provider last
 * said.
 *
 * The consequence worth naming: a role can never be changed by signing in. A
 * promoted admin who signs in on a second device stays an admin, because the
 * candidate that says `role: 'user'` is never written over an existing
 * document — see `createUserIfAbsent` for how that holds under a race.
 *
 * ## Why the email is normalized here
 *
 * `email` is the one candidate field whose value is raw provider input. Every
 * other email write path normalizes at the boundary (`waitlist`, guest
 * registrations, guest doc ids), and reads such as
 * `findRegistrationsByEmail` depend on that. Normalizing here keeps
 * `users/{uid}.email` on the same rule without moving field semantics into
 * `createUserIfAbsent`, whose job is the transaction, not the document shape.
 */

/**
 * The platform role a brand-new account gets. Least privilege — promotion to
 * `admin` is a deliberate act elsewhere, never something a sign-in can do.
 */
export const DEFAULT_PLATFORM_ROLE: PlatformRole = 'user';

/** Who signed in, as proved by the session cookie that was just minted. */
export interface SignInIdentity {
  uid: string;
  email: string;
  name?: string;
}

export interface UserUpsertDeps {
  /** `createUserIfAbsent` from `@upskills/firestore`. */
  createUserIfAbsent(user: User): Promise<CreateUserResult>;
  /** Injected clock, because `Timestamp` is a Firebase value import. */
  now(): Timestamp;
}

/**
 * Ensure `users/{uid}` exists, and return whatever is stored.
 *
 * An existing document wins in every field, so a caller cannot use this to
 * change a role, an email, or anything else — that is the entire contract.
 */
export function upsertUserOnSignIn(
  identity: SignInIdentity,
  deps: UserUpsertDeps,
): Promise<CreateUserResult> {
  const candidate: User = {
    uid: identity.uid,
    email: normalizeEmail(identity.email),
    ...(identity.name === undefined ? {} : { name: identity.name }),
    role: DEFAULT_PLATFORM_ROLE,
    orgIds: [],
    createdAt: deps.now(),
  };

  return deps.createUserIfAbsent(candidate);
}
