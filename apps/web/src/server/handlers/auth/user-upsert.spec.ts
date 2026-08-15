import type { CreateUserResult } from '@upskills/firestore';
import type { User } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { fakeTimestamp } from '../../testing/fakes';
import { upsertUserOnSignIn, type UserUpsertDeps } from './user-upsert';

/**
 * Issue #39's sign-in policy: what a *first* sign-in writes.
 *
 * The write itself — the transaction, and the guarantee that a second sign-in
 * cannot overwrite a promoted admin even under a race — belongs to
 * `createUserIfAbsent` in `@upskills/firestore` and is proven there against the
 * real emulator (`users.spec.ts`, `users.concurrency.spec.ts`). Faking it here
 * would only re-assert a store's behaviour against a store this app does not
 * ship. What is left, and what this covers, is the document this app asks for.
 */

const UID = 'uid-alice';
const CREATED_AT = fakeTimestamp(new Date('2026-01-02T03:04:05.000Z'));

const identity = { uid: UID, email: 'alice@example.com', name: 'Alice' };

function deps(result?: CreateUserResult): UserUpsertDeps {
  return {
    createUserIfAbsent: vi.fn(
      async (user: User) => result ?? { user, created: true },
    ),
    now: () => CREATED_AT,
  };
}

describe('upsertUserOnSignIn', () => {
  it('asks for a user with role "user" and no orgs', async () => {
    const d = deps();

    const result = await upsertUserOnSignIn(identity, d);

    expect(d.createUserIfAbsent).toHaveBeenCalledWith({
      uid: UID,
      email: 'alice@example.com',
      name: 'Alice',
      role: 'user',
      orgIds: [],
      createdAt: CREATED_AT,
    });
    expect(result.created).toBe(true);
  });

  it('normalizes a mixed-case email before asking for the document', async () => {
    const d = deps();

    await upsertUserOnSignIn(
      { uid: UID, email: 'Ada@Example.com', name: 'Ada' },
      d,
    );

    expect(d.createUserIfAbsent).toHaveBeenCalledWith({
      uid: UID,
      email: 'ada@example.com',
      name: 'Ada',
      role: 'user',
      orgIds: [],
      createdAt: CREATED_AT,
    });
  });

  it('omits the name rather than storing undefined when the token has none', async () => {
    const d = deps();

    await upsertUserOnSignIn({ uid: UID, email: 'alice@example.com' }, d);

    const [candidate] = vi.mocked(d.createUserIfAbsent).mock.calls[0] ?? [];
    expect(candidate && 'name' in candidate).toBe(false);
  });

  it('reports the stored document, not the one it asked for', async () => {
    // A promoted admin signing in again: the candidate says `user`, the stored
    // document says `admin`, and the route must act on what is stored.
    const stored: User = {
      uid: UID,
      email: 'alice@example.com',
      role: 'admin',
      orgIds: ['org-1'],
      createdAt: fakeTimestamp(new Date('2025-01-01T00:00:00.000Z')),
    };
    const d = deps({ user: stored, created: false });

    const result = await upsertUserOnSignIn(identity, d);

    expect(result).toEqual({ user: stored, created: false });
  });

  it('never asks for a role other than the default', async () => {
    // The candidate is built the same way on every exchange — there is no
    // branch that could carry a caller-supplied role into the write.
    const d = deps({
      user: { ...identity, role: 'admin', orgIds: [], createdAt: CREATED_AT },
      created: false,
    });

    await upsertUserOnSignIn(identity, d);

    expect(d.createUserIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' }),
    );
  });
});
