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

function request(eventId = 'evt-1', orgId = 'org-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/dashboard/events/${eventId}?orgId=${orgId}`,
    params: { eventId },
  }).event;
}

describe('GET /api/v1/dashboard/events/:eventId', () => {
  it('authorizes the ?orgId= org, reads the event, and returns it', async () => {
    const getEvent = vi.fn(async () => fakeEvent({ status: 'draft' }));
    const d = deps({ getEvent });
    const event = request();

    const result = await createDashboardEventsDetailHandler(d)(event);

    expect(getEvent).toHaveBeenCalledWith('org-1', 'evt-1');
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

  // A Firestore `Timestamp` serializes to `{_seconds,_nanoseconds}` — an object
  // with no `toDate()`. Returning the raw document would type-check against
  // `WorkshopEvent` and then throw `startsAt.toDate is not a function` in the
  // browser, so the conversion is the contract, not an implementation detail.
  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps();

    const result = (await createDashboardEventsDetailHandler(d)(
      request(),
    )) as Awaited<
      ReturnType<ReturnType<typeof createDashboardEventsDetailHandler>>
    >;

    const workshop = (result as { event: Record<string, unknown> }).event;

    for (const field of ['startsAt', 'createdAt', 'updatedAt'] as const) {
      expect(typeof workshop[field]).toBe('string');
      expect(new Date(workshop[field] as string).toISOString()).toBe(
        workshop[field],
      );
    }
  });

  it('answers 403, not 404, for a missing event', async () => {
    const getEvent = vi.fn(async () => null);
    const d = deps({ getEvent });

    await expect(
      createDashboardEventsDetailHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    // The role check now runs first, against `?orgId=`, so it *has* been
    // called by this point. What still must not happen is a 404: a missing
    // event and somebody else's event answer identically.
    expect(getEvent).toHaveBeenCalledWith('org-1', 'nope');
  });

  it('answers 403 for an event owned by another org', async () => {
    // Another org's event is not "found and refused" any more — it is simply
    // absent from `organizers/org-1/events`, because ownership is the path.
    // `getEvent` returning null is what that looks like from here, and the
    // answer is the same 403 a missing event gets.
    const getEvent = vi.fn(async () => null);
    const d = deps({ getEvent });
    const event = request();

    await expect(
      createDashboardEventsDetailHandler(d)(event),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(getEvent).toHaveBeenCalledWith('org-1', 'evt-1');
  });

  it('authorizes the org from ?orgId=, never one taken from the event', async () => {
    // The event body is deliberately stamped with a different org. If the
    // handler ever authorized against *that*, a caller could name their own
    // org in the query and still reach an event claiming to belong elsewhere.
    const d = deps({
      getEvent: vi.fn(async () => fakeEvent({ orgId: 'org-999' })),
    });
    const event = request('evt-1', 'org-1');

    await createDashboardEventsDetailHandler(d)(event);

    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
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
