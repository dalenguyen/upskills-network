import type { OrgContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardOrgsDetailHandler,
  type DashboardOrgsDetailDeps,
} from './orgs-detail';

/** `GET /api/v1/dashboard/orgs/:orgId` — the caller's own org detail. */

const ORG: OrgContext = {
  uid: 'uid-1',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'admin',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

function deps(
  overrides: Partial<DashboardOrgsDetailDeps> = {},
): DashboardOrgsDetailDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    ...overrides,
  };
}

function request(orgId = 'org-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/dashboard/orgs/${orgId}`,
    params: { orgId },
  }).event;
}

describe('GET /api/v1/dashboard/orgs/:orgId', () => {
  it('authorizes against the route org id and returns the guarded org', async () => {
    const d = deps();
    const event = request();

    const result = await createDashboardOrgsDetailHandler(d)(event);

    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
      'check_in',
      'volunteer',
    );
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

  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps();

    const result = (await createDashboardOrgsDetailHandler(d)(
      request(),
    )) as Awaited<
      ReturnType<ReturnType<typeof createDashboardOrgsDetailHandler>>
    >;

    const org = (result as { org: Record<string, unknown> }).org;
    const members = org['members'] as Record<string, Record<string, unknown>>;

    expect(typeof org['createdAt']).toBe('string');
    expect(typeof members['uid-1']?.['addedAt']).toBe('string');
  });

  it('answers 400 for a missing org id', async () => {
    const d = deps();

    await expect(
      createDashboardOrgsDetailHandler(d)(
        createTestEvent({
          method: 'GET',
          url: '/api/v1/dashboard/orgs',
        }).event,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-org-id' },
    });
    expect(d.requireOrgRole).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in caller who is not a member', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeForbiddenError(
          'One of [admin, manager, check_in, volunteer] in org "org-1" is required.',
        );
      }),
    });

    await expect(
      createDashboardOrgsDetailHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardOrgsDetailHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });
});
