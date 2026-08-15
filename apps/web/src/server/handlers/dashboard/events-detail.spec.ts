import type { AuthContext, OrgContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsDetailHandler,
  type DashboardEventsDetailDeps,
} from './events-detail';

/** `GET /api/v1/dashboard/events/:eventId` — the organizer event detail. */

const ORG: OrgContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'manager',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

const AUTH: AuthContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as AuthContext['session'],
};

function deps(
  overrides: Partial<DashboardEventsDetailDeps> = {},
): DashboardEventsDetailDeps {
  return {
    requireAuth: vi.fn(async () => AUTH),
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    ...overrides,
  };
}

function request(eventId = 'evt-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/dashboard/events/${eventId}`,
    params: { eventId },
  }).event;
}

describe('GET /api/v1/dashboard/events/:eventId', () => {
  it('reads the event by id, authorizes against its org, and returns it', async () => {
    const getEvent = vi.fn(async () => fakeEvent({ status: 'draft' }));
    const d = deps({ getEvent });
    const event = request();

    const result = await createDashboardEventsDetailHandler(d)(event);

    expect(getEvent).toHaveBeenCalledWith('evt-1');
    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(result).toEqual({
      event: expect.objectContaining({ eventId: 'evt-1', status: 'draft' }),
    });
  });

  it('answers 403, not 404, for a missing event', async () => {
    const d = deps({ getEvent: vi.fn(async () => null) });

    await expect(
      createDashboardEventsDetailHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.requireOrgRole).not.toHaveBeenCalled();
  });

  it('answers 403 for an event owned by another org', async () => {
    const requireOrgRole = vi.fn(async () => {
      throw fakeForbiddenError(
        'One of [admin, manager] in org "org-2" is required.',
      );
    });
    const d = deps({
      getEvent: vi.fn(async () => fakeEvent({ orgId: 'org-2' })),
      requireOrgRole,
    });
    const event = request();

    await expect(
      createDashboardEventsDetailHandler(d)(event),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-2',
      'admin',
      'manager',
    );
  });

  it('answers 403 for a check_in or volunteer member', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeForbiddenError(
          'One of [admin, manager] in org "org-1" is required.',
        );
      }),
    });

    await expect(
      createDashboardEventsDetailHandler(d)(request()),
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
      createDashboardEventsDetailHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('answers 401 identically whether or not the event exists', async () => {
    // The whole point of the shared 403 is that event ids cannot be probed.
    // If the session were only checked by requireOrgRole -- which runs after
    // the read -- an unauthenticated caller would get 403 for a missing event
    // and 401 for a real one, and the pair of statuses would rebuild the
    // oracle. Both must be 401, and getEvent must never run.
    const unauthenticated = () =>
      deps({
        requireAuth: vi.fn(async () => {
          throw fakeInvalidSessionError('expired');
        }),
      });

    const missing = unauthenticated();
    missing.getEvent = vi.fn(async () => null);
    const existing = unauthenticated();
    existing.getEvent = vi.fn(async () => fakeEvent({ status: 'draft' }));

    for (const d of [missing, existing]) {
      await expect(
        createDashboardEventsDetailHandler(d)(request()),
      ).rejects.toMatchObject({
        statusCode: 401,
        data: { error: 'invalid-session', reason: 'expired' },
      });
      expect(d.getEvent).not.toHaveBeenCalled();
    }
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      getEvent: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createDashboardEventsDetailHandler(d)(request())).rejects.toBe(
      bug,
    );
  });
});
