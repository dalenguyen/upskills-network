import type { AuthContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import { fakeForbiddenError, fakeInvalidSessionError } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeOrg } from '../../testing/public-fixtures';
import { createOrgsDetailHandler, type OrgsDetailDeps } from './orgs-detail';

/** `GET /api/v1/admin/orgs/:orgId` — the platform-admin org detail. */

const ADMIN: AuthContext = {
  uid: 'uid-admin',
  role: 'admin',
  session: {} as AuthContext['session'],
};

function deps(overrides: Partial<OrgsDetailDeps> = {}): OrgsDetailDeps {
  return {
    requireAdmin: vi.fn(async () => ADMIN),
    getOrg: vi.fn(async () => fakeOrg()),
    ...overrides,
  };
}

function request(orgId = 'org-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/admin/orgs/${orgId}`,
    params: { orgId },
  }).event;
}

describe('GET /api/v1/admin/orgs/:orgId', () => {
  it('requires an admin and returns the org by id', async () => {
    const d = deps();

    const result = await createOrgsDetailHandler(d)(request());

    expect(d.requireAdmin).toHaveBeenCalledOnce();
    expect(d.getOrg).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({
      org: expect.objectContaining({ orgId: 'org-1' }),
    });
  });

  it('answers 404 for an unknown org id', async () => {
    const d = deps({ getOrg: vi.fn(async () => null) });

    await expect(createOrgsDetailHandler(d)(request('nope'))).rejects.toMatchObject(
      {
        statusCode: 404,
        data: { error: 'org-not-found' },
      },
    );
  });

  it('answers 403 for a signed-in caller who is not an admin', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeForbiddenError('Platform role "admin" is required.');
      }),
    });

    await expect(createOrgsDetailHandler(d)(request())).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.getOrg).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(createOrgsDetailHandler(d)(request())).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createOrgsDetailHandler(
        deps({
          getOrg: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(request()),
    ).rejects.toBe(bug);
  });
});
