import type { User } from '@upskills/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { T0, at, seedUser } from '../testing/seed';
import { userRef } from './collections';
import { getUser } from './reads';
import { createUserIfAbsent } from './users';

/**
 * Issue #39 — the write behind the first sign-in, against the real emulator.
 * The race lives in `users.concurrency.spec.ts`; everything here is about what
 * one caller at a time is told and what document is left behind.
 */

const NEW_USER: User = {
  uid: 'uid-new',
  email: 'new@example.com',
  name: 'Newcomer',
  role: 'user',
  orgIds: [],
  createdAt: T0,
};

beforeEach(clearFirestore);

describe('createUserIfAbsent', () => {
  it('creates the document when there is none', async () => {
    const result = await createUserIfAbsent(NEW_USER);

    expect(result).toEqual({ user: NEW_USER, created: true });
    expect((await userRef(NEW_USER.uid).get()).data()).toEqual(NEW_USER);
  });

  it('stores a document the normal read path can return', async () => {
    // Proof the converter and the document shape agree — a write only this
    // module performs, read back through the helper every route uses.
    await createUserIfAbsent(NEW_USER);

    expect(await getUser(NEW_USER.uid)).toEqual(NEW_USER);
  });

  it('leaves an existing admin alone and reports it as not created', async () => {
    const admin = await seedUser({ uid: 'uid-admin', role: 'admin' });

    const result = await createUserIfAbsent({
      ...NEW_USER,
      uid: 'uid-admin',
      role: 'user',
    });

    // The acceptance criterion: a second sign-in cannot demote a promoted user.
    expect(result).toEqual({ user: admin, created: false });
    expect((await userRef('uid-admin').get()).data()).toEqual(admin);
  });

  it('writes nothing at all when the document exists', async () => {
    const existing = await seedUser({
      uid: 'uid-existing',
      email: 'old@example.com',
      name: 'Old Name',
      orgIds: ['org-1'],
      createdAt: at(-60),
    });

    await createUserIfAbsent({
      uid: 'uid-existing',
      email: 'new@example.com',
      name: 'New Name',
      role: 'user',
      orgIds: [],
      createdAt: T0,
    });

    // Not "everything except role" — every field survives, including the
    // original `createdAt`, which is how you can tell nothing was written.
    expect((await userRef('uid-existing').get()).data()).toEqual(existing);
  });

  it('stamps the id from the path onto the document it returns', async () => {
    // The stored body carries `uid` too, but the path is what the document
    // actually is; a body that disagreed must not be what the caller sees.
    await userRef('uid-mismatch').set({
      ...NEW_USER,
      uid: 'uid-something-else',
    });

    const result = await createUserIfAbsent({
      ...NEW_USER,
      uid: 'uid-mismatch',
    });

    expect(result.created).toBe(false);
    expect(result.user.uid).toBe('uid-mismatch');
  });

  it('is a no-op when called twice in a row', async () => {
    const first = await createUserIfAbsent(NEW_USER);
    const second = await createUserIfAbsent(NEW_USER);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.user).toEqual(NEW_USER);
  });
});
