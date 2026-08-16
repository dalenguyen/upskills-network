import type { OrgContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeLastOrgAdminError,
  fakeOrgNotFoundError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardOrgMembersRemoveHandler,
  type DashboardOrgMembersRemoveDeps,
} from './org-members-remove';

/** `DELETE /api/v1/dashboard/orgs/:orgId/members`. */

const ORG: OrgContext = {
  uid: 'uid-admin',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'admin',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

function deps(
  overrides: Partial<DashboardOrgMembersRemoveDeps> = {},
): DashboardOrgMembersRemoveDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    removeOrgMember: vi.fn(async () => fakeOrg()),
    ...overrides,
  };
}

function request(body: unknown, orgId = 'org-1') {
  return createTestEvent({
    method: 'DELETE',
    url: `/api/v1/dashboard/orgs/${orgId}/members`,
    params: { orgId },
    body,
  }).event;
}

describe('DELETE /api/v1/dashboard/orgs/:orgId/members', () => {
  it('requires an org admin and removes the member named by the body', async () => {
    const removeOrgMember = vi.fn(async (): Promise<Organizer> => fakeOrg());
    const d = deps({ removeOrgMember });
    const event = request({ uid: 'uid-2' });

    const result = await createDashboardOrgMembersRemoveHandler(d)(event);

    expect(d.requireOrgRole).toHaveBeenCalledWith(event, 'org-1', 'admin');
    expect(removeOrgMember).toHaveBeenCalledWith('org-1', 'uid-2');
    expect(result).toEqual({
      org: expect.objectContaining({
        orgId: 'org-1',
        createdAt: FIXTURE_START.toISOString(),
        members: expect.objectContaining({
          'uid-1': expect.objectContaining({
            role: 'admin',
            addedAt: FIXTURE_START.toISOString(),
          }),
        }),
      }),
    });
  });

  it('answers 400 for a body without a uid', async () => {
    const d = deps();

    await expect(
      createDashboardOrgMembersRemoveHandler(d)(request({ role: 'manager' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-member' },
    });
    expect(d.removeOrgMember).not.toHaveBeenCalled();
  });

  it('answers 409 when removing the last admin', async () => {
    const d = deps({
      removeOrgMember: vi.fn(async () => {
        throw fakeLastOrgAdminError('org-1', 'uid-1');
      }),
    });

    await expect(
      createDashboardOrgMembersRemoveHandler(d)(request({ uid: 'uid-1' })),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'last-org-admin' },
    });
  });

  it('answers 404 when the write names an org that does not exist', async () => {
    const d = deps({
      removeOrgMember: vi.fn(async () => {
        throw fakeOrgNotFoundError('org-missing');
      }),
    });

    await expect(
      createDashboardOrgMembersRemoveHandler(d)(
        request({ uid: 'uid-2' }, 'org-missing'),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'org-not-found' },
    });
  });

  it('answers 403 for a signed-in caller who is not an org admin', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeForbiddenError('One of [admin] in org "org-1" is required.');
      }),
    });

    await expect(
      createDashboardOrgMembersRemoveHandler(d)(request({ uid: 'uid-2' })),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.removeOrgMember).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardOrgMembersRemoveHandler(d)(request({ uid: 'uid-2' })),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createDashboardOrgMembersRemoveHandler(
        deps({
          removeOrgMember: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(request({ uid: 'uid-2' })),
    ).rejects.toBe(bug);
  });
});
