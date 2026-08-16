import type { AuthContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeOrg } from '../../testing/public-fixtures';
import { createOrgsListHandler, type OrgsListDeps } from './orgs-list';

/** `GET /api/v1/admin/orgs` — the platform-admin org index. */

const ADMIN: AuthContext = {
  uid: 'uid-admin',
  role: 'admin',
  session: {} as AuthContext['session'],
};

function deps(overrides: Partial<OrgsListDeps> = {}): OrgsListDeps {
  return {
    requireAdmin: vi.fn(async () => ADMIN),
    listOrgs: vi.fn(async () => [fakeOrg()]),
    ...overrides,
  };
}

function request() {
  return createTestEvent({
    method: 'GET',
    url: '/api/v1/admin/orgs',
  }).event;
}

describe('GET /api/v1/admin/orgs', () => {
  it('requires an admin and returns every org', async () => {
    const d = deps();

    const result = await createOrgsListHandler(d)(request());

    expect(d.requireAdmin).toHaveBeenCalledOnce();
    expect(d.listOrgs).toHaveBeenCalledOnce();
    expect(result).toEqual({
      orgs: [
        expect.objectContaining({
          orgId: 'org-1',
          createdAt: FIXTURE_START.toISOString(),
          members: expect.objectContaining({
            'uid-1': expect.objectContaining({
              role: 'admin',
              addedAt: FIXTURE_START.toISOString(),
            }),
          }),
        }),
      ],
    });
  });

  it('answers 403 for a signed-in caller who is not an admin', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeForbiddenError('Platform role "admin" is required.');
      }),
    });

    await expect(createOrgsListHandler(d)(request())).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.listOrgs).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(createOrgsListHandler(d)(request())).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createOrgsListHandler(
        deps({
          listOrgs: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(request()),
    ).rejects.toBe(bug);
  });
});
