import type { AuthContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeInviteEmailMismatchError,
  fakeInvalidSessionError,
  fakeInviteNotPendingError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeInvite, fakeOrg, fakeUser } from '../../testing/public-fixtures';
import {
  createInviteAcceptHandler,
  createInviteDetailHandler,
  type InviteAcceptDeps,
  type InviteDetailDeps,
} from './invite-accept';

/** `GET /api/v1/invites/:token` and `POST /api/v1/invites/:token/accept`. */

const INVITEE: AuthContext = {
  uid: 'uid-grace',
  role: 'user',
  session: {} as AuthContext['session'],
};

function detailDeps(
  overrides: Partial<InviteDetailDeps> = {},
): InviteDetailDeps {
  return {
    findOrgInviteByToken: vi.fn(async () => fakeInvite()),
    orgInviteStatus: vi.fn(() => 'pending' as const),
    getOrg: vi.fn(async () => fakeOrg()),
    ...overrides,
  };
}

function acceptDeps(
  overrides: Partial<InviteAcceptDeps> = {},
): InviteAcceptDeps {
  return {
    requireAuth: vi.fn(async () => INVITEE),
    findOrgInviteByToken: vi.fn(async () => fakeInvite()),
    orgInviteStatus: vi.fn(() => 'pending' as const),
    getUser: vi.fn(async () =>
      fakeUser({ uid: 'uid-grace', email: 'grace@example.com' }),
    ),
    acceptOrgInvite: vi.fn(async () => ({
      org: fakeOrg(),
      invite: fakeInvite(),
    })),
    ...overrides,
  };
}

function request(token = 'tok-1', method: 'GET' | 'POST' = 'GET') {
  return createTestEvent({
    method,
    url: `/api/v1/invites/${token}`,
    params: { token },
  }).event;
}

describe('GET /api/v1/invites/:token', () => {
  it('answers what the invitation offers, without a session', async () => {
    const d = detailDeps();

    const result = await createInviteDetailHandler(d)(request());

    expect(d.findOrgInviteByToken).toHaveBeenCalledWith('tok-1');
    expect(result).toEqual({
      invite: {
        orgName: 'Upskills Toronto',
        role: 'manager',
        email: 'grace@example.com',
        expiresAt: expect.any(String),
      },
    });
  });

  it('answers nothing about the org beyond its name', async () => {
    const result = await createInviteDetailHandler(detailDeps())(request());

    // No roster, no member count, no slug — the token buys the offer only.
    expect(JSON.stringify(result)).not.toContain('uid-1');
    expect(JSON.stringify(result)).not.toContain('memberUids');
  });

  it('answers 404 for a token nobody was sent', async () => {
    const d = detailDeps({ findOrgInviteByToken: vi.fn(async () => null) });

    await expect(
      createInviteDetailHandler(d)(request('made-up')),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'invite-not-found' },
    });
  });

  it('answers 409 for a spent invitation', async () => {
    const d = detailDeps({ orgInviteStatus: vi.fn(() => 'accepted' as const) });

    await expect(createInviteDetailHandler(d)(request())).rejects.toMatchObject(
      { statusCode: 409, data: { error: 'invite-not-pending' } },
    );
  });

  it('answers 400 for an empty token segment', async () => {
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/invites/',
      params: {},
    }).event;

    await expect(
      createInviteDetailHandler(detailDeps())(event),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-token' },
    });
  });
});

describe('POST /api/v1/invites/:token/accept', () => {
  it('writes the membership for the signed-in invitee', async () => {
    const d = acceptDeps();

    const result = await createInviteAcceptHandler(d)(request('tok-1', 'POST'));

    expect(d.acceptOrgInvite).toHaveBeenCalledWith('inv-1', {
      uid: 'uid-grace',
      email: 'grace@example.com',
    });
    expect(result).toEqual({
      orgId: 'org-1',
      orgName: 'Upskills Toronto',
      role: 'manager',
    });
  });

  it('answers 401 for a caller with no session, without reading the invite', async () => {
    const d = acceptDeps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createInviteAcceptHandler(d)(request('tok-1', 'POST')),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.acceptOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 403 when the session is a different person than the invitee', async () => {
    const d = acceptDeps({
      acceptOrgInvite: vi.fn(async (): Promise<never> => {
        throw fakeInviteEmailMismatchError('inv-1');
      }),
    });

    await expect(
      createInviteAcceptHandler(d)(request('tok-1', 'POST')),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'invite-email-mismatch' },
    });
  });

  it('does not echo the invited address in the mismatch response', async () => {
    const d = acceptDeps({
      acceptOrgInvite: vi.fn(async (): Promise<never> => {
        throw fakeInviteEmailMismatchError('inv-1');
      }),
    });

    const error = await createInviteAcceptHandler(d)(
      request('tok-1', 'POST'),
    ).catch((thrown: unknown) => thrown);

    expect(JSON.stringify(error)).not.toContain('grace@example.com');
  });

  it('answers 409 when the invitation was already accepted', async () => {
    const d = acceptDeps({
      acceptOrgInvite: vi.fn(async (): Promise<never> => {
        throw fakeInviteNotPendingError('inv-1', 'accepted');
      }),
    });

    await expect(
      createInviteAcceptHandler(d)(request('tok-1', 'POST')),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'invite-not-pending' },
    });
  });

  it('answers 409 for an expired invitation before it authorizes anything', async () => {
    const d = acceptDeps({ orgInviteStatus: vi.fn(() => 'expired' as const) });

    await expect(
      createInviteAcceptHandler(d)(request('tok-1', 'POST')),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'invite-not-pending' },
    });
    expect(d.acceptOrgInvite).not.toHaveBeenCalled();
  });

  it('answers 404 for a token nobody was sent', async () => {
    const d = acceptDeps({ findOrgInviteByToken: vi.fn(async () => null) });

    await expect(
      createInviteAcceptHandler(d)(request('made-up', 'POST')),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'invite-not-found' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = acceptDeps({
      acceptOrgInvite: vi.fn(async (): Promise<never> => {
        throw bug;
      }),
    });

    await expect(
      createInviteAcceptHandler(d)(request('tok-1', 'POST')),
    ).rejects.toBe(bug);
  });
});
