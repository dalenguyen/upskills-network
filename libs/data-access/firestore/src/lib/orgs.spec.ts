import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { T0, seedEvent, seedOrg, seedUser } from '../testing/seed';
import { orgInvitesCol, orgsCol, orgSlugRef, userRef } from './collections';
import { createOrgInvite } from './invites';
import {
  LastOrgAdminError,
  OrgLimitExceededError,
  OrgNotEmptyError,
  createOrg,
  deleteOrg,
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

  it('links the org on the creator in the same commit', async () => {
    await seedUser({ uid: 'uid-1', orgIds: [] });

    const org = await createOrg({
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      createdBy: 'uid-1',
    });

    expect((await userRef('uid-1').get()).data()?.orgIds).toEqual([org.orgId]);
  });

  it('throws OrgLimitExceededError for a creator who already has an org', async () => {
    await seedUser({ uid: 'uid-1', orgIds: ['org-existing'] });

    await expect(
      createOrg({ name: 'Another', slug: 'another', createdBy: 'uid-1' }),
    ).rejects.toBeInstanceOf(OrgLimitExceededError);

    // The aborted transaction leaves no slug reservation or organizer behind.
    expect((await orgSlugRef('another').get()).data()).toBeUndefined();
    expect((await orgsCol().get()).docs).toHaveLength(0);
  });

  it('allows a second org when allowMultiple waives the limit, appending to orgIds', async () => {
    // The platform-admin path. The rule is a self-service guard, and the person
    // running the site joins their own org on day one — without the waiver they
    // could never create the curated org that community listings belong under.
    await seedUser({ uid: 'uid-1', orgIds: ['org-existing'] });

    const org = await createOrg({
      name: 'Community',
      slug: 'community',
      createdBy: 'uid-1',
      allowMultiple: true,
    });

    expect(await getOrg(org.orgId)).toMatchObject({
      slug: 'community',
      members: { 'uid-1': { role: 'admin' } },
    });

    // Appended, not replaced: the first org must survive.
    expect((await userRef('uid-1').get()).data()?.orgIds).toEqual([
      'org-existing',
      org.orgId,
    ]);
  });

  it('still enforces the limit when allowMultiple is absent or false', async () => {
    await seedUser({ uid: 'uid-1', orgIds: ['org-existing'] });

    await expect(
      createOrg({
        name: 'Another',
        slug: 'another',
        createdBy: 'uid-1',
        allowMultiple: false,
      }),
    ).rejects.toBeInstanceOf(OrgLimitExceededError);
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

describe('deleteOrg', () => {
  it('removes the org, frees its slug, and lets the member start over', async () => {
    await seedUser({ uid: 'uid-1', orgIds: ['org-1'] });
    await seedOrg({ orgId: 'org-1', slug: 'upskills-yyz', createdBy: 'uid-1' });

    await deleteOrg('org-1');

    await expect(getOrg('org-1')).resolves.toBeNull();
    await expect(orgSlugRef('upskills-yyz').get()).resolves.toMatchObject({
      exists: false,
    });
    // The `orgIds` entry is what `createOrg` reads to enforce one-org-per-user,
    // so leaving it behind would lock the member out of ever creating another.
    expect((await userRef('uid-1').get()).data()?.orgIds).toEqual([]);
  });

  it('refuses while the org still owns an event, of any status', async () => {
    await seedUser({ uid: 'uid-1', orgIds: ['org-1'] });
    await seedOrg({ orgId: 'org-1', slug: 'upskills-yyz', createdBy: 'uid-1' });
    await seedEvent({ eventId: 'evt-1', orgId: 'org-1', status: 'cancelled' });

    await expect(deleteOrg('org-1')).rejects.toThrow(OrgNotEmptyError);

    // Nothing was half-applied: the org and its slug are both still there.
    await expect(getOrg('org-1')).resolves.toMatchObject({ orgId: 'org-1' });
    await expect(orgSlugRef('upskills-yyz').get()).resolves.toMatchObject({
      exists: true,
    });
  });

  it('revokes pending invitations, which nothing else would clean up', async () => {
    await seedUser({ uid: 'uid-1', orgIds: ['org-1'] });
    await seedOrg({ orgId: 'org-1', slug: 'upskills-yyz', createdBy: 'uid-1' });
    await createOrgInvite({
      orgId: 'org-1',
      email: 'grace@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await deleteOrg('org-1');

    // `orgInvites` is top-level, so these would otherwise outlive the org they
    // name and keep appearing in every invite listing.
    const left = await orgInvitesCol().where('orgId', '==', 'org-1').get();
    expect(left.empty).toBe(true);
  });
});
