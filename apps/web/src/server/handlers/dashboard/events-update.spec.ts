import type { AuthContext, OrgContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeSlugTakenError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsUpdateHandler,
  type DashboardEventsUpdateDeps,
} from './events-update';

/** `PUT /api/v1/dashboard/events/:eventId` — the organizer event update route. */

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
  overrides: Partial<DashboardEventsUpdateDeps> = {},
): DashboardEventsUpdateDeps {
  return {
    requireAuth: vi.fn(async () => AUTH),
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    updateEvent: vi.fn(async () =>
      fakeEvent({ status: 'draft', title: 'New title' }),
    ),
    ...overrides,
  };
}

function request(body: unknown, eventId = 'evt-1', orgId = 'org-1') {
  return createTestEvent({
    method: 'PUT',
    url: `/api/v1/dashboard/events/${eventId}?orgId=${orgId}`,
    params: { eventId },
    body,
  }).event;
}

describe('PUT /api/v1/dashboard/events/:eventId', () => {
  it('authorizes the ?orgId= org, validates, and updates', async () => {
    const updateEvent = vi.fn(async () =>
      fakeEvent({ status: 'draft', title: 'New title' }),
    );
    const d = deps({ updateEvent });
    const event = request({ title: '  New title  ' });

    const result = await createDashboardEventsUpdateHandler(d)(event);

    expect(d.getEvent).toHaveBeenCalledWith('org-1', 'evt-1');
    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(updateEvent).toHaveBeenCalledWith('org-1', 'evt-1', {
      title: 'New title',
    });
    expect(result).toEqual({
      event: expect.objectContaining({ eventId: 'evt-1', title: 'New title' }),
    });
  });

  // A Firestore `Timestamp` serializes to `{_seconds,_nanoseconds}` — an object
  // with no `toDate()`. Returning the raw document would type-check against
  // `WorkshopEvent` and then throw `startsAt.toDate is not a function` in the
  // browser, so the conversion is the contract, not an implementation detail.
  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps();

    const result = (await createDashboardEventsUpdateHandler(d)(
      request({ title: 'New title' }),
    )) as Awaited<
      ReturnType<ReturnType<typeof createDashboardEventsUpdateHandler>>
    >;

    const workshop = (result as { event: Record<string, unknown> }).event;

    for (const field of ['startsAt', 'createdAt', 'updatedAt'] as const) {
      expect(typeof workshop[field]).toBe('string');
      expect(new Date(workshop[field] as string).toISOString()).toBe(
        workshop[field],
      );
    }
  });

  it('forwards a draft/published status change', async () => {
    const updateEvent = vi.fn(async () => fakeEvent({ status: 'published' }));
    const d = deps({ updateEvent });

    await createDashboardEventsUpdateHandler(d)(
      request({ status: 'published' }),
    );

    expect(updateEvent).toHaveBeenCalledWith('org-1', 'evt-1', {
      status: 'published',
    });
  });

  it('answers 403, not 404, for a missing event', async () => {
    const d = deps({ getEvent: vi.fn(async () => null) });

    await expect(
      createDashboardEventsUpdateHandler(d)(
        request({ title: 'New title' }, 'nope'),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    // The role check now runs first, against `?orgId=`. What still must not
    // happen is a 404: a missing event answers exactly as somebody else's does.
    expect(d.getEvent).toHaveBeenCalled();
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('answers 403 for an event owned by another org', async () => {
    // Another org's event is simply absent from `organizers/org-1/events` —
    // ownership is the path — so it reads as null and gets the same 403 a
    // missing event gets.
    const getEvent = vi.fn(async () => null);
    const d = deps({ getEvent });

    await expect(
      createDashboardEventsUpdateHandler(d)(request({ title: 'New title' })),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(getEvent).toHaveBeenCalledWith('org-1', 'evt-1');
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
      createDashboardEventsUpdateHandler(d)(request({ title: 'New title' })),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session before reading the body', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardEventsUpdateHandler(d)(request({})),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('answers 400 for an empty body after authorization', async () => {
    const d = deps();

    await expect(
      createDashboardEventsUpdateHandler(d)(request({})),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-event' },
    });
    expect(d.requireOrgRole).toHaveBeenCalledOnce();
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('refuses status cancelled rather than applying it', async () => {
    const d = deps();

    await expect(
      createDashboardEventsUpdateHandler(d)(request({ status: 'cancelled' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-event' },
    });
    expect(d.requireOrgRole).toHaveBeenCalledOnce();
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('answers 409 when the new slug is already taken', async () => {
    const d = deps({
      updateEvent: vi.fn(async () => {
        throw fakeSlugTakenError('taken-slug');
      }),
    });

    await expect(
      createDashboardEventsUpdateHandler(d)(request({ slug: 'taken-slug' })),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'slug-taken' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      updateEvent: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(
      createDashboardEventsUpdateHandler(d)(request({ title: 'New title' })),
    ).rejects.toBe(bug);
  });
});
