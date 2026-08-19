import type { Organizer } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { fakeForbiddenError, fakeOrgNotFoundError } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import {
  FIXTURE_EMAILS,
  fakeInvite,
  fakeOrg,
  fakeUser,
} from '../../testing/public-fixtures';
import { toAdminOrg, type AdminOrg } from '../admin/admin-view';
import {
  createOrgInvitesConfirmHandler,
  createOrgInvitesCreateHandler,
  createOrgInvitesRevokeHandler,
  type OrgInvitesConfirmDeps,
  type OrgInvitesCreateDeps,
  type OrgInvitesRevokeDeps,
} from './org-invites';

/**
 * The invitation routes, exercised through the admin projection.
 *
 * The surfaces share these handlers, so the behavior is proved once here and
 * the per-surface specs only need to prove their own authorization — which is
 * the whole reason the authorization is a dependency.
 */

const AUTHORIZED = { uid: 'uid-1', org: fakeOrg() };

function base() {
  return {
    authorizeOrg: vi.fn(async () => AUTHORIZED),
    serializeOrg: toAdminOrg,
    getUserEmails: vi.fn(async () => FIXTURE_EMAILS),
    listOrgInvites: vi.fn(async () => [fakeInvite()]),
    orgInviteStatus: vi.fn(() => 'pending' as const),
  };
}

function createDeps(
  overrides: Partial<OrgInvitesCreateDeps<AdminOrg>> = {},
): OrgInvitesCreateDeps<AdminOrg> {
  return {
    ...base(),
    createOrgInvite: vi.fn(async () => fakeInvite()),
    getUser: vi.fn(async () => fakeUser({ name: 'Ada' })),
    sendOrgInviteEmail: vi.fn(async () => ({ sent: true })),
    ...overrides,
  };
}

function revokeDeps(
  overrides: Partial<OrgInvitesRevokeDeps<AdminOrg>> = {},
): OrgInvitesRevokeDeps<AdminOrg> {
  return {
    ...base(),
    getOrgInvite: vi.fn(async () => fakeInvite()),
    revokeOrgInvite: vi.fn(async () => fakeInvite()),
    ...overrides,
  };
}

function confirmDeps(
  overrides: Partial<OrgInvitesConfirmDeps<AdminOrg>> = {},
): OrgInvitesConfirmDeps<AdminOrg> {
  return {
    ...base(),
    getOrgInvite: vi.fn(async () => fakeInvite()),
    findUserByEmail: vi.fn(async () => fakeUser({ uid: 'uid-grace' })),
    acceptOrgInvite: vi.fn(async () => ({
      org: fakeOrg(),
      invite: fakeInvite(),
    })),
    ...overrides,
  };
}

function request(body: unknown, orgId = 'org-1', path = 'invites') {
  return createTestEvent({
    method: 'POST',
    url: `/api/v1/admin/orgs/${orgId}/${path}`,
    params: { orgId },
    body,
  }).event;
}

describe('POST /…/orgs/:orgId/invites', () => {
  it('creates the invitation and mails the token', async () => {
    const d = createDeps();

    const result = await createOrgInvitesCreateHandler(d)(
      request({ email: '  Grace@Example.COM ', role: 'manager' }),
    );

    expect(d.createOrgInvite).toHaveBeenCalledWith({
      orgId: 'org-1',
      email: 'grace@example.com',
      role: 'manager',
      invitedBy: 'uid-1',
    });
    expect(d.sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'grace@example.com',
        orgName: 'Upskills Toronto',
        role: 'manager',
        token: 'tok-1',
        invitedByName: 'Ada',
      }),
    );
    expect(result).toMatchObject({
      org: { orgId: 'org-1' },
      invites: [
        { inviteId: 'inv-1', email: 'grace@example.com', status: 'pending' },
      ],
    });
  });

  it('never returns the token to the browser', async () => {
    const result = await createOrgInvitesCreateHandler(createDeps())(
      request({ email: 'grace@example.com', role: 'manager' }),
    );

    expect(JSON.stringify(result)).not.toContain('tok-1');
  });

  it('answers 409 for somebody who is already a member', async () => {
    const d = createDeps();

    await expect(
      createOrgInvitesCreateHandler(d)(
        // `FIXTURE_EMAILS` maps the fixture org's only member to this address.
        request({ email: 'ada@example.com', role: 'manager' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'already-a-member' },
    });
    expect(d.createOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not { email, role }', async () => {
    const d = createDeps();

    await expect(
      createOrgInvitesCreateHandler(d)(request({ email: 'grace@example.com' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-invite' },
    });
    expect(d.createOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 403 without writing when the caller may not manage the org', async () => {
    const d = createDeps({
      authorizeOrg: vi.fn(async () => {
        throw fakeForbiddenError('Org role "admin" is required.');
      }),
    });

    await expect(
      createOrgInvitesCreateHandler(d)(
        request({ email: 'grace@example.com', role: 'manager' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, data: { error: 'forbidden' } });
    expect(d.createOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 404 when the org does not exist', async () => {
    const d = createDeps({
      createOrgInvite: vi.fn(async () => {
        throw fakeOrgNotFoundError('org-1');
      }),
    });

    await expect(
      createOrgInvitesCreateHandler(d)(
        request({ email: 'grace@example.com', role: 'manager' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'org-not-found' },
    });
  });
});

describe('DELETE /…/orgs/:orgId/invites', () => {
  it('revokes the invitation named by the body', async () => {
    const d = revokeDeps();

    const result = await createOrgInvitesRevokeHandler(d)(
      request({ inviteId: 'inv-1' }),
    );

    expect(d.revokeOrgInvite).toHaveBeenCalledWith('inv-1');
    expect(result).toMatchObject({ org: { orgId: 'org-1' } });
  });

  it('answers 404 for an invitation belonging to another org', async () => {
    const d = revokeDeps({
      getOrgInvite: vi.fn(async () => fakeInvite({ orgId: 'org-other' })),
    });

    await expect(
      createOrgInvitesRevokeHandler(d)(request({ inviteId: 'inv-1' })),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'invite-not-found' },
    });
    expect(d.revokeOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 404 for an invitation that does not exist', async () => {
    const d = revokeDeps({ getOrgInvite: vi.fn(async () => null) });

    await expect(
      createOrgInvitesRevokeHandler(d)(request({ inviteId: 'gone' })),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'invite-not-found' },
    });
  });

  it('answers 400 for a body with no inviteId', async () => {
    await expect(
      createOrgInvitesRevokeHandler(revokeDeps())(request({})),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-invite' },
    });
  });
});

describe('POST /…/orgs/:orgId/invites/confirm', () => {
  it('accepts on the invitee behalf, recording the confirming admin', async () => {
    const d = confirmDeps();

    const result = await createOrgInvitesConfirmHandler(d)(
      request({ inviteId: 'inv-1' }, 'org-1', 'invites/confirm'),
    );

    expect(d.findUserByEmail).toHaveBeenCalledWith('grace@example.com');
    expect(d.acceptOrgInvite).toHaveBeenCalledWith('inv-1', {
      uid: 'uid-grace',
      acceptedByAdmin: 'uid-1',
    });
    expect(result).toMatchObject({ org: { orgId: 'org-1' } });
  });

  it('answers 409 when the invited address has no account yet', async () => {
    const d = confirmDeps({ findUserByEmail: vi.fn(async () => null) });

    await expect(
      createOrgInvitesConfirmHandler(d)(
        request({ inviteId: 'inv-1' }, 'org-1', 'invites/confirm'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'invitee-has-no-account' },
    });
    expect(d.acceptOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 409 for an invitation that is no longer pending', async () => {
    const d = confirmDeps({ orgInviteStatus: vi.fn(() => 'expired' as const) });

    await expect(
      createOrgInvitesConfirmHandler(d)(
        request({ inviteId: 'inv-1' }, 'org-1', 'invites/confirm'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'invite-not-pending' },
    });
    expect(d.acceptOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 404 for an invitation belonging to another org', async () => {
    const d = confirmDeps({
      getOrgInvite: vi.fn(async () => fakeInvite({ orgId: 'org-other' })),
    });

    await expect(
      createOrgInvitesConfirmHandler(d)(
        request({ inviteId: 'inv-1' }, 'org-1', 'invites/confirm'),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'invite-not-found' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = confirmDeps({
      acceptOrgInvite: vi.fn(async (): Promise<never> => {
        throw bug;
      }),
    });

    await expect(
      createOrgInvitesConfirmHandler(d)(
        request({ inviteId: 'inv-1' }, 'org-1', 'invites/confirm'),
      ),
    ).rejects.toBe(bug);
  });
});

describe('every invite route', () => {
  it('answers the roster and the outstanding invitations together', async () => {
    const org: Organizer = fakeOrg();
    const d = createDeps({
      authorizeOrg: vi.fn(async () => ({ uid: 'uid-1', org })),
    });

    const result = await createOrgInvitesCreateHandler(d)(
      request({ email: 'grace@example.com', role: 'manager' }),
    );

    expect(result).toMatchObject({
      org: { members: { 'uid-1': { email: 'ada@example.com' } } },
      invites: [{ email: 'grace@example.com', role: 'manager' }],
    });
  });
});
