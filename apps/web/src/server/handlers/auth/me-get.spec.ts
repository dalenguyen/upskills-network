import type { AuthContext, SessionUser } from '@upskills/auth';
import type { Organizer, User } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeTimestamp,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { createMeGetHandler, type MeGetDeps } from './me-get';

/**
 * `GET /api/v1/auth/me` — the response the client's route guards are built on.
 */

const UID = 'uid-alice';
const CREATED_AT = new Date('2026-01-02T03:04:05.000Z');

const CONTEXT: AuthContext = {
  uid: UID,
  role: 'user',
  session: {
    uid: UID,
    admin: false,
    expiresAt: new Date('2026-01-07T00:00:00.000Z'),
    claims: {} as unknown as SessionUser['claims'],
  },
};

const USER: User = {
  uid: UID,
  email: 'alice@example.com',
  name: 'Alice',
  role: 'user',
  orgIds: ['org-1'],
  createdAt: fakeTimestamp(CREATED_AT),
};

function org(overrides: Partial<Organizer> = {}): Organizer {
  return {
    orgId: 'org-1',
    name: 'React Toronto',
    slug: 'react-toronto',
    createdBy: 'uid-bob',
    members: {
      [UID]: { role: 'manager', addedAt: fakeTimestamp(CREATED_AT) },
      'uid-bob': { role: 'admin', addedAt: fakeTimestamp(CREATED_AT) },
    },
    memberUids: [UID, 'uid-bob'],
    createdAt: fakeTimestamp(CREATED_AT),
    ...overrides,
  };
}

function deps(overrides: Partial<MeGetDeps> = {}): MeGetDeps {
  return {
    requireAuth: vi.fn(async () => CONTEXT),
    getUser: vi.fn(async () => USER),
    getOrg: vi.fn(async () => org()),
    ...overrides,
  };
}

function get() {
  return createTestEvent({ method: 'GET', url: '/api/v1/auth/me' });
}

describe('GET /api/v1/auth/me', () => {
  it('returns the caller and the orgs they belong to', async () => {
    const result = await createMeGetHandler(deps())(get().event);

    expect(result).toEqual({
      user: {
        uid: UID,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      orgs: [
        {
          orgId: 'org-1',
          name: 'React Toronto',
          slug: 'react-toronto',
          role: 'manager',
        },
      ],
    });
  });

  it('does not ship the org membership roster to the browser', async () => {
    // `toEqual` above already pins the shape; this names the reason, because
    // an `Organizer` carries every member's uid and role.
    const result = (await createMeGetHandler(deps())(get().event)) as {
      orgs: Record<string, unknown>[];
    };

    expect(Object.keys(result.orgs[0] ?? {}).sort()).toEqual([
      'name',
      'orgId',
      'role',
      'slug',
    ]);
  });

  it('omits an org the caller is no longer a member of', async () => {
    // `User.orgIds` is a denormalized mirror and can lag a removal. Answering
    // from it alone would hand an ex-member the org's name and slug.
    const d = deps({
      getOrg: vi.fn(async () =>
        org({
          members: {
            'uid-bob': { role: 'admin', addedAt: fakeTimestamp(CREATED_AT) },
          },
          memberUids: ['uid-bob'],
        }),
      ),
    });

    const result = await createMeGetHandler(d)(get().event);

    expect(result).toMatchObject({ orgs: [] });
  });

  it('omits an org that no longer exists', async () => {
    const d = deps({ getOrg: vi.fn(async () => null) });

    const result = await createMeGetHandler(d)(get().event);

    expect(result).toMatchObject({ orgs: [] });
  });

  it('reports the role from the organizer document, not the platform role', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => ({ ...CONTEXT, role: 'admin' as const })),
      getUser: vi.fn(async () => ({ ...USER, role: 'admin' as const })),
      getOrg: vi.fn(async () =>
        org({
          members: {
            [UID]: { role: 'check_in', addedAt: fakeTimestamp(CREATED_AT) },
          },
          memberUids: [UID],
        }),
      ),
    });

    const result = (await createMeGetHandler(d)(get().event)) as {
      user: { role: string };
      orgs: { role: string }[];
    };

    expect(result.user.role).toBe('admin');
    expect(result.orgs[0]?.role).toBe('check_in');
  });

  it('reads every org the user belongs to, in order', async () => {
    const d = deps({
      getUser: vi.fn(async () => ({ ...USER, orgIds: ['org-1', 'org-2'] })),
      getOrg: vi.fn(async (orgId: string) =>
        org({
          orgId,
          name: `Org ${orgId}`,
          slug: orgId,
          memberUids: [UID],
        }),
      ),
    });

    const result = (await createMeGetHandler(d)(get().event)) as {
      orgs: { orgId: string }[];
    };

    expect(result.orgs.map((o) => o.orgId)).toEqual(['org-1', 'org-2']);
  });

  it('answers 401 when there is no usable session', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('revoked');
      }),
    });

    await expect(createMeGetHandler(d)(get().event)).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'revoked' },
    });
    expect(d.getUser).not.toHaveBeenCalled();
  });

  it('answers 403 without echoing what the guard said', async () => {
    // `ForbiddenError`'s message names roles and org ids for an operator's log.
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeForbiddenError('Platform role "admin" is required.');
      }),
    });

    await expect(createMeGetHandler(d)(get().event)).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    await expect(createMeGetHandler(d)(get().event)).rejects.not.toMatchObject({
      message: 'Platform role "admin" is required.',
    });
  });

  it('answers 404, not 401, when the session is good but the document is gone', async () => {
    const d = deps({ getUser: vi.fn(async () => null) });

    await expect(createMeGetHandler(d)(get().event)).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'user-not-found' },
    });
  });

  it('lets an unrecognized failure stay a 500', async () => {
    const bug = new TypeError('firestore client is undefined');
    const d = deps({
      getUser: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createMeGetHandler(d)(get().event)).rejects.toBe(bug);
  });
});
