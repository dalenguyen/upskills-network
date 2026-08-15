import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeLastOrgAdminError,
  fakeOrgNotFoundError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeOrg } from '../../testing/public-fixtures';
import {
  createOrgMembersSetHandler,
  type OrgMembersSetDeps,
} from './org-members-set';

/** `POST` / `PUT /api/v1/admin/orgs/:orgId/members`. */

const ADMIN: AuthContext = {
  uid: 'uid-admin',
  role: 'admin',
  session: {} as AuthContext['session'],
};

function deps(overrides: Partial<OrgMembersSetDeps> = {}): OrgMembersSetDeps {
  return {
    requireAdmin: vi.fn(async () => ADMIN),
    setOrgMember: vi.fn(async () => fakeOrg()),
    ...overrides,
  };
}

function request(
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
  orgId = 'org-1',
) {
  return createTestEvent({
    method,
    url: `/api/v1/admin/orgs/${orgId}/members`,
    params: { orgId },
    body,
  }).event;
}

describe('POST /api/v1/admin/orgs/:orgId/members', () => {
  it('adds or changes the member named by the body', async () => {
    const setOrgMember = vi.fn(async (): Promise<Organizer> => fakeOrg());

    const result = await createOrgMembersSetHandler(deps({ setOrgMember }))(
      request({ uid: 'uid-2', role: 'manager' }),
    );

    expect(setOrgMember).toHaveBeenCalledWith('org-1', 'uid-2', 'manager');
    expect(result).toEqual({
      org: expect.objectContaining({ orgId: 'org-1' }),
    });
  });

  it('answers 400 for a body that is not { uid, role }', async () => {
    const d = deps();

    await expect(
      createOrgMembersSetHandler(d)(request({ uid: 'uid-2' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-member' },
    });
    expect(d.setOrgMember).not.toHaveBeenCalled();
  });

  it('answers 409 when the change would remove the last admin', async () => {
    const d = deps({
      setOrgMember: vi.fn(async () => {
        throw fakeLastOrgAdminError('org-1', 'uid-1');
      }),
    });

    await expect(
      createOrgMembersSetHandler(d)(
        request({ uid: 'uid-1', role: 'manager' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'last-org-admin' },
    });
  });

  it('answers 404 when the org does not exist', async () => {
    const d = deps({
      setOrgMember: vi.fn(async () => {
        throw fakeOrgNotFoundError('org-missing');
      }),
    });

    await expect(
      createOrgMembersSetHandler(d)(
        request({ uid: 'uid-2', role: 'manager' }, 'POST', 'org-missing'),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'org-not-found' },
    });
  });

  it('answers 403 for a signed-in caller who is not an admin', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeForbiddenError('Platform role "admin" is required.');
      }),
    });

    await expect(
      createOrgMembersSetHandler(d)(
        request({ uid: 'uid-2', role: 'manager' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.setOrgMember).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createOrgMembersSetHandler(d)(
        request({ uid: 'uid-2', role: 'manager' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createOrgMembersSetHandler(
        deps({
          setOrgMember: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(request({ uid: 'uid-2', role: 'manager' })),
    ).rejects.toBe(bug);
  });
});
