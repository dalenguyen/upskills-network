import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeInvalidSessionError,
  fakeInvalidSlugError,
  fakeOrgLimitExceededError,
  fakeSlugTakenError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import {
  FIXTURE_EMAILS,
  FIXTURE_START,
  fakeOrg,
} from '../../testing/public-fixtures';
import {
  createDashboardOrgsCreateHandler,
  type DashboardOrgsCreateDeps,
} from './orgs-create';

/** `POST /api/v1/dashboard/orgs` — create the caller's own organizer. */

const CALLER: AuthContext = {
  uid: 'uid-1',
  role: 'user',
  session: {} as AuthContext['session'],
};

function deps(
  overrides: Partial<DashboardOrgsCreateDeps> = {},
): DashboardOrgsCreateDeps {
  return {
    requireAuth: vi.fn(async () => CALLER),
    createOrg: vi.fn(async () => fakeOrg()),
    getUserEmails: vi.fn(async () => FIXTURE_EMAILS),
    ...overrides,
  };
}

function post(body: unknown) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/dashboard/orgs',
    body,
  }).event;
}

describe('POST /api/v1/dashboard/orgs', () => {
  it('creates the org with the session uid as creator', async () => {
    const createOrg = vi.fn(async (): Promise<Organizer> => fakeOrg());

    const result = await createDashboardOrgsCreateHandler(deps({ createOrg }))(
      post({ name: '  Upskills Ottawa  ', slug: '  upskills-ottawa  ' }),
    );

    expect(createOrg).toHaveBeenCalledWith({
      name: 'Upskills Ottawa',
      slug: 'upskills-ottawa',
      createdBy: 'uid-1',
    });
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

  it('stamps createdBy from the session, never from the body', async () => {
    const createOrg = vi.fn(async (): Promise<Organizer> => fakeOrg());

    await createDashboardOrgsCreateHandler(deps({ createOrg }))(
      post({
        name: 'Upskills Ottawa',
        slug: 'upskills-ottawa',
        createdBy: 'uid-from-body',
      }),
    );

    expect(createOrg).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'uid-1' }),
    );
  });

  it('answers 400 for a body that is not { name, slug }', async () => {
    const d = deps();

    await expect(
      createDashboardOrgsCreateHandler(d)(post({ name: 'Missing slug' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-org' },
    });
    expect(d.createOrg).not.toHaveBeenCalled();
  });

  it('answers 409 when the slug is already taken', async () => {
    const d = deps({
      createOrg: vi.fn(async () => {
        throw fakeSlugTakenError('upskills-ottawa');
      }),
    });

    await expect(
      createDashboardOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'slug-taken' },
    });
  });

  it('answers 409 when the caller already belongs to an org', async () => {
    const d = deps({
      createOrg: vi.fn(async () => {
        throw fakeOrgLimitExceededError('uid-1');
      }),
    });

    await expect(
      createDashboardOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'org-limit-exceeded' },
    });
  });

  it('answers 400 when the slug is not usable', async () => {
    const d = deps({
      createOrg: vi.fn(async () => {
        throw fakeInvalidSlugError('Not A Slug');
      }),
    });

    await expect(
      createDashboardOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'not-a-slug' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-slug' },
    });
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.createOrg).not.toHaveBeenCalled();
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createDashboardOrgsCreateHandler(
        deps({
          createOrg: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' })),
    ).rejects.toBe(bug);
  });
});
