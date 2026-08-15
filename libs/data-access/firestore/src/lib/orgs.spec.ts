import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { T0, seedOrg } from '../testing/seed';
import { orgsCol, orgSlugRef } from './collections';
import {
  LastOrgAdminError,
  createOrg,
  removeOrgMember,
  setOrgMember,
} from './orgs';
import { getOrg } from './reads';
import { SlugTakenError } from './slugs';

/**
 * Org write transactions, against the Firestore emulator.
 *
 * The whole point is the invariant: `members` and `memberUids` are one fact in
 * two shapes, and every write here must commit both of them together.
 */

beforeEach(clearFirestore);

describe('createOrg', () => {
  it('writes the organizer and its slug reservation together', async () => {
    const org = await createOrg({
      name: '  Upskills Toronto  ',
      slug: '  upskills-toronto  ',
      createdBy: 'uid-1',
    });

    expect(org).toMatchObject({
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      createdBy: 'uid-1',
      memberUids: ['uid-1'],
    });
    expect(org.members['uid-1']).toMatchObject({ role: 'admin' });

    expect(await getOrg(org.orgId)).toMatchObject({
      orgId: org.orgId,
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      createdBy: 'uid-1',
      memberUids: ['uid-1'],
    });
    expect((await orgSlugRef('upskills-toronto').get()).data()).toEqual({
      orgId: org.orgId,
    });
  });

  it('throws SlugTakenError for a taken slug and leaves no organizer behind', async () => {
    await seedOrg({ orgId: 'org-existing', slug: 'taken' });

    await expect(
      createOrg({ name: 'Another Org', slug: 'taken', createdBy: 'uid-2' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    const docs = (await orgsCol().get()).docs.map((snapshot) =>
      snapshot.data(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ orgId: 'org-existing', slug: 'taken' });
  });
});

describe('org membership writes keep members and memberUids in sync', () => {
  it('adds a member in both fields', async () => {
    await seedOrg({ orgId: 'org-1' });

    const org = await setOrgMember('org-1', 'uid-2', 'manager');

    expect(org.members['uid-2']).toMatchObject({ role: 'manager' });
    expect(org.memberUids).toEqual(Object.keys(org.members));

    const stored = await getOrg('org-1');
    expect(stored?.members['uid-2']).toMatchObject({ role: 'manager' });
    expect(stored?.memberUids).toEqual(Object.keys(stored?.members ?? {}));
  });

  it('changes an existing member role in both fields', async () => {
    await seedOrg({
      orgId: 'org-1',
      members: {
        'uid-1': { role: 'admin', addedAt: T0 },
        'uid-2': { role: 'manager', addedAt: T0 },
      },
      memberUids: ['uid-1', 'uid-2'],
    });

    const org = await setOrgMember('org-1', 'uid-2', 'check_in');

    expect(org.members['uid-2']).toMatchObject({ role: 'check_in' });
    expect(org.memberUids).toEqual(Object.keys(org.members));

    const stored = await getOrg('org-1');
    expect(stored?.members['uid-2']).toMatchObject({ role: 'check_in' });
    expect(stored?.memberUids).toEqual(Object.keys(stored?.members ?? {}));
  });

  it('removes a member from both fields', async () => {
    await seedOrg({
      orgId: 'org-1',
      members: {
        'uid-1': { role: 'admin', addedAt: T0 },
        'uid-2': { role: 'manager', addedAt: T0 },
      },
      memberUids: ['uid-1', 'uid-2'],
    });

    const org = await removeOrgMember('org-1', 'uid-2');

    expect(org.members['uid-2']).toBeUndefined();
    expect(org.memberUids).toEqual(Object.keys(org.members));

    const stored = await getOrg('org-1');
    expect(stored?.members['uid-2']).toBeUndefined();
    expect(stored?.memberUids).toEqual(['uid-1']);
  });
});

describe('last-admin guard', () => {
  it('refuses to remove the last admin', async () => {
    await seedOrg({ orgId: 'org-1' });

    await expect(removeOrgMember('org-1', 'uid-1')).rejects.toBeInstanceOf(
      LastOrgAdminError,
    );

    const org = await getOrg('org-1');
    expect(org?.members['uid-1']).toMatchObject({ role: 'admin' });
    expect(org?.memberUids).toEqual(['uid-1']);
  });

  it('refuses to demote the last admin', async () => {
    await seedOrg({ orgId: 'org-1' });

    await expect(
      setOrgMember('org-1', 'uid-1', 'manager'),
    ).rejects.toBeInstanceOf(LastOrgAdminError);

    const org = await getOrg('org-1');
    expect(org?.members['uid-1']).toMatchObject({ role: 'admin' });
    expect(org?.memberUids).toEqual(['uid-1']);
  });

  it('allows removing a non-last admin', async () => {
    await seedOrg({
      orgId: 'org-1',
      members: {
        'uid-1': { role: 'admin', addedAt: T0 },
        'uid-2': { role: 'admin', addedAt: T0 },
      },
      memberUids: ['uid-1', 'uid-2'],
    });

    await expect(removeOrgMember('org-1', 'uid-1')).resolves.toMatchObject({
      memberUids: ['uid-2'],
    });

    const org = await getOrg('org-1');
    expect(org?.members['uid-1']).toBeUndefined();
    expect(org?.members['uid-2']).toMatchObject({ role: 'admin' });
    expect(org?.memberUids).toEqual(['uid-2']);
  });

  it('allows removing a non-admin member', async () => {
    await seedOrg({
      orgId: 'org-1',
      members: {
        'uid-1': { role: 'admin', addedAt: T0 },
        'uid-2': { role: 'volunteer', addedAt: T0 },
      },
      memberUids: ['uid-1', 'uid-2'],
    });

    await expect(removeOrgMember('org-1', 'uid-2')).resolves.toMatchObject({
      memberUids: ['uid-1'],
    });

    const org = await getOrg('org-1');
    expect(org?.members['uid-2']).toBeUndefined();
    expect(org?.members['uid-1']).toMatchObject({ role: 'admin' });
    expect(org?.memberUids).toEqual(['uid-1']);
  });
});
