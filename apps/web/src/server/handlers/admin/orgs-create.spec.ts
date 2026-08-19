import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
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
import { createOrgsCreateHandler, type OrgsCreateDeps } from './orgs-create';

/** `POST /api/v1/admin/orgs` — create an organizer as its first admin. */

const ADMIN: AuthContext = {
  uid: 'uid-admin',
  role: 'admin',
  session: {} as AuthContext['session'],
};

function deps(overrides: Partial<OrgsCreateDeps> = {}): OrgsCreateDeps {
  return {
    requireAdmin: vi.fn(async () => ADMIN),
    createOrg: vi.fn(async () => fakeOrg()),
    getUserEmails: vi.fn(async () => FIXTURE_EMAILS),
    ...overrides,
  };
}

function post(body: unknown) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/admin/orgs',
    body,
  }).event;
}

describe('POST /api/v1/admin/orgs', () => {
  it('creates the org with the authenticated admin as creator', async () => {
    const createOrg = vi.fn(async (): Promise<Organizer> => fakeOrg());

    const result = await createOrgsCreateHandler(deps({ createOrg }))(
      post({ name: '  Upskills Ottawa  ', slug: '  upskills-ottawa  ' }),
    );

    expect(createOrg).toHaveBeenCalledWith({
      name: 'Upskills Ottawa',
      slug: 'upskills-ottawa',
      createdBy: 'uid-admin',
      // The admin route waives the one-org-per-user rule. Asserted as part of
      // the exact call so it cannot be dropped silently — without it, the
      // person running the platform can never create a second organizer.
      allowMultiple: true,
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

  it('answers 400 for a body that is not { name, slug }', async () => {
    const d = deps();

    await expect(
      createOrgsCreateHandler(d)(post({ name: 'Missing slug' })),
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
      createOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'slug-taken' },
    });
  });

  it('answers 409 when the admin already belongs to an org', async () => {
    const d = deps({
      createOrg: vi.fn(async () => {
        throw fakeOrgLimitExceededError('uid-admin');
      }),
    });

    await expect(
      createOrgsCreateHandler(d)(
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
      createOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'not-a-slug' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-slug' },
    });
  });

  it('answers 403 for a signed-in caller who is not an admin', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeForbiddenError('Platform role "admin" is required.');
      }),
    });

    await expect(
      createOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.createOrg).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireAdmin: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createOrgsCreateHandler(d)(
        post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createOrgsCreateHandler(
        deps({
          createOrg: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(post({ name: 'Upskills Ottawa', slug: 'upskills-ottawa' })),
    ).rejects.toBe(bug);
  });
});
