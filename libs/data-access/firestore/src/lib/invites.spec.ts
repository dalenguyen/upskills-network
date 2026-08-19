import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedOrg } from '../testing/seed';
import { orgInviteRef } from './collections';
import {
  INVITE_TTL_DAYS,
  InviteEmailMismatchError,
  InviteNotFoundError,
  InviteNotPendingError,
  acceptOrgInvite,
  createOrgInvite,
  findOrgInviteByToken,
  getOrgInvite,
  listOrgInvites,
  orgInviteStatus,
  revokeOrgInvite,
} from './invites';
import { OrgNotFoundError } from './orgs';
import { getOrg } from './reads';

/**
 * Invitations, against the Firestore emulator.
 *
 * Two properties carry the weight here: an invitation writes **no** membership
 * until it is accepted, and acceptance writes the membership and spends the
 * invitation in one commit. Everything else — expiry, revocation, resending —
 * is bookkeeping on top of those.
 */

beforeEach(clearFirestore);

/** An invitation whose expiry is already in the past. */
async function seedExpiredInvite(orgId: string, email: string) {
  const invite = await createOrgInvite({
    orgId,
    email,
    role: 'volunteer',
    invitedBy: 'uid-1',
  });

  await orgInviteRef(invite.inviteId).update({
    expiresAt: Timestamp.fromMillis(Date.now() - 1000),
  });

  return invite;
}

describe('createOrgInvite', () => {
  it('stores a normalized, unaccepted invitation with a random token', async () => {
    const org = await seedOrg({ orgId: 'org-1' });

    const invite = await createOrgInvite({
      orgId: org.orgId,
      email: '  Ada@Example.COM ',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    expect(invite).toMatchObject({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });
    expect(invite.token.length).toBeGreaterThan(20);
    expect(invite.acceptedAt).toBeUndefined();
    expect(orgInviteStatus(invite)).toBe('pending');
  });

  it('expires the invitation INVITE_TTL_DAYS out', async () => {
    const org = await seedOrg({ orgId: 'org-1' });

    const invite = await createOrgInvite({
      orgId: org.orgId,
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const days =
      (invite.expiresAt.toMillis() - invite.createdAt.toMillis()) /
      (24 * 60 * 60 * 1000);

    expect(days).toBeCloseTo(INVITE_TTL_DAYS, 5);
  });

  it('writes no membership — an invitation is an offer, not access', async () => {
    const org = await seedOrg({ orgId: 'org-1' });

    await createOrgInvite({
      orgId: org.orgId,
      email: 'ada@example.com',
      role: 'admin',
      invitedBy: 'uid-1',
    });

    const stored = await getOrg('org-1');

    expect(stored?.memberUids).toEqual(org.memberUids);
    expect(Object.keys(stored?.members ?? {})).toEqual(
      Object.keys(org.members),
    );
  });

  it('revokes the previous invitation for the same address — resending', async () => {
    const org = await seedOrg({ orgId: 'org-1' });

    const first = await createOrgInvite({
      orgId: org.orgId,
      email: 'ada@example.com',
      role: 'volunteer',
      invitedBy: 'uid-1',
    });
    const second = await createOrgInvite({
      orgId: org.orgId,
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    // One mailbox never holds two working links.
    const stale = await getOrgInvite(first.inviteId);
    expect(stale && orgInviteStatus(stale)).toBe('revoked');
    expect(await findOrgInviteByToken(first.token)).toMatchObject({
      revokedAt: expect.anything(),
    });
    expect(orgInviteStatus(second)).toBe('pending');
  });

  it('leaves another org invitation for the same address alone', async () => {
    await seedOrg({ orgId: 'org-1', slug: 'org-one' });
    await seedOrg({ orgId: 'org-2', slug: 'org-two' });

    const first = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'volunteer',
      invitedBy: 'uid-1',
    });
    await createOrgInvite({
      orgId: 'org-2',
      email: 'ada@example.com',
      role: 'volunteer',
      invitedBy: 'uid-1',
    });

    const stored = await getOrgInvite(first.inviteId);
    expect(stored && orgInviteStatus(stored)).toBe('pending');
  });

  it('rejects an invitation to an org that does not exist', async () => {
    await expect(
      createOrgInvite({
        orgId: 'org-missing',
        email: 'ada@example.com',
        role: 'volunteer',
        invitedBy: 'uid-1',
      }),
    ).rejects.toBeInstanceOf(OrgNotFoundError);
  });
});

describe('findOrgInviteByToken', () => {
  it('finds the invitation a token accepts', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    expect(await findOrgInviteByToken(invite.token)).toMatchObject({
      inviteId: invite.inviteId,
      email: 'ada@example.com',
    });
  });

  it('returns null for a token nobody was sent', async () => {
    await expect(findOrgInviteByToken('made-up')).resolves.toBeNull();
  });
});

describe('listOrgInvites', () => {
  it('answers the outstanding invitations, oldest first', async () => {
    await seedOrg({ orgId: 'org-1' });

    await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });
    await createOrgInvite({
      orgId: 'org-1',
      email: 'grace@example.com',
      role: 'volunteer',
      invitedBy: 'uid-1',
    });

    expect((await listOrgInvites('org-1')).map((i) => i.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });

  it('leaves out revoked and accepted invitations', async () => {
    await seedOrg({ orgId: 'org-1' });

    const revoked = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });
    const accepted = await createOrgInvite({
      orgId: 'org-1',
      email: 'grace@example.com',
      role: 'volunteer',
      invitedBy: 'uid-1',
    });
    const outstanding = await createOrgInvite({
      orgId: 'org-1',
      email: 'hopper@example.com',
      role: 'check_in',
      invitedBy: 'uid-1',
    });

    await revokeOrgInvite(revoked.inviteId);
    await acceptOrgInvite(accepted.inviteId, { uid: 'uid-grace' });

    expect((await listOrgInvites('org-1')).map((i) => i.inviteId)).toEqual([
      outstanding.inviteId,
    ]);
  });

  it('keeps an expired invitation on the list, so it can be resent', async () => {
    await seedOrg({ orgId: 'org-1' });
    const expired = await seedExpiredInvite('org-1', 'ada@example.com');

    const listed = await listOrgInvites('org-1');

    expect(listed.map((i) => i.inviteId)).toEqual([expired.inviteId]);
    expect(orgInviteStatus(listed[0])).toBe('expired');
  });
});

describe('acceptOrgInvite', () => {
  it('writes members and memberUids together, and spends the invitation', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const result = await acceptOrgInvite(invite.inviteId, {
      uid: 'uid-ada',
      email: 'ada@example.com',
    });

    expect(result.org.members['uid-ada']).toMatchObject({ role: 'manager' });
    expect(result.org.memberUids).toContain('uid-ada');

    const stored = await getOrg('org-1');
    expect(stored?.members['uid-ada']).toMatchObject({ role: 'manager' });
    expect(stored?.memberUids).toContain('uid-ada');

    const spent = await getOrgInvite(invite.inviteId);
    expect(spent && orgInviteStatus(spent)).toBe('accepted');
    expect(spent?.acceptedBy).toBe('uid-ada');
  });

  it('refuses a second acceptance of the same invitation', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await acceptOrgInvite(invite.inviteId, { uid: 'uid-ada' });

    await expect(
      acceptOrgInvite(invite.inviteId, { uid: 'uid-ada' }),
    ).rejects.toBeInstanceOf(InviteNotPendingError);
  });

  it('refuses an account whose email is not the invited one', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await expect(
      acceptOrgInvite(invite.inviteId, {
        uid: 'uid-mallory',
        email: 'mallory@example.com',
      }),
    ).rejects.toBeInstanceOf(InviteEmailMismatchError);

    // The forwarded link wrote nothing.
    expect((await getOrg('org-1'))?.memberUids).not.toContain('uid-mallory');
  });

  it('accepts a mixed-case sign-in of the invited address', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await expect(
      acceptOrgInvite(invite.inviteId, {
        uid: 'uid-ada',
        email: 'Ada@Example.COM',
      }),
    ).resolves.toMatchObject({ invite: { acceptedBy: 'uid-ada' } });
  });

  it('refuses an expired invitation', async () => {
    await seedOrg({ orgId: 'org-1' });
    const expired = await seedExpiredInvite('org-1', 'ada@example.com');

    await expect(
      acceptOrgInvite(expired.inviteId, { uid: 'uid-ada' }),
    ).rejects.toBeInstanceOf(InviteNotPendingError);
  });

  it('refuses a revoked invitation', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await revokeOrgInvite(invite.inviteId);

    await expect(
      acceptOrgInvite(invite.inviteId, { uid: 'uid-ada' }),
    ).rejects.toBeInstanceOf(InviteNotPendingError);
  });

  it('records the admin who confirmed on the invitee behalf', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'check_in',
      invitedBy: 'uid-1',
    });

    const { invite: accepted } = await acceptOrgInvite(invite.inviteId, {
      uid: 'uid-ada',
      acceptedByAdmin: 'uid-1',
    });

    expect(accepted).toMatchObject({
      acceptedBy: 'uid-ada',
      acceptedByAdmin: 'uid-1',
    });
    expect((await getOrgInvite(invite.inviteId))?.acceptedByAdmin).toBe(
      'uid-1',
    );
  });

  it('keeps the original addedAt when a former member rejoins', async () => {
    const org = await seedOrg({ orgId: 'org-1' });
    const firstJoined = org.members['uid-1'].addedAt;

    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const { org: updated } = await acceptOrgInvite(invite.inviteId, {
      uid: 'uid-1',
    });

    expect(updated.members['uid-1'].addedAt.toMillis()).toBe(
      firstJoined.toMillis(),
    );
    expect(updated.members['uid-1'].role).toBe('manager');
  });

  it('rejects a token that names no invitation', async () => {
    await expect(
      acceptOrgInvite('nope', { uid: 'uid-ada' }),
    ).rejects.toBeInstanceOf(InviteNotFoundError);
  });
});

describe('revokeOrgInvite', () => {
  it('stops the token working', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const revoked = await revokeOrgInvite(invite.inviteId);

    expect(orgInviteStatus(revoked)).toBe('revoked');
  });

  it('is a no-op the second time', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const first = await revokeOrgInvite(invite.inviteId);
    const second = await revokeOrgInvite(invite.inviteId);

    expect(second.revokedAt?.toMillis()).toBe(first.revokedAt?.toMillis());
  });

  it('refuses to revoke an invitation that was already accepted', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    await acceptOrgInvite(invite.inviteId, { uid: 'uid-ada' });

    await expect(revokeOrgInvite(invite.inviteId)).rejects.toBeInstanceOf(
      InviteNotPendingError,
    );
  });

  it('rejects an id that names no invitation', async () => {
    await expect(revokeOrgInvite('nope')).rejects.toBeInstanceOf(
      InviteNotFoundError,
    );
  });
});

describe('orgInviteStatus', () => {
  it('reads expiry against the clock it is given', async () => {
    await seedOrg({ orgId: 'org-1' });
    const invite = await createOrgInvite({
      orgId: 'org-1',
      email: 'ada@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });

    const afterExpiry = new Date(invite.expiresAt.toMillis() + 1);

    expect(orgInviteStatus(invite)).toBe('pending');
    expect(orgInviteStatus(invite, afterExpiry)).toBe('expired');
  });
});
