import type { OrgContext } from '@upskills/auth';
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

function deps(
  overrides: Partial<DashboardEventsUpdateDeps> = {},
): DashboardEventsUpdateDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    updateEvent: vi.fn(async () =>
      fakeEvent({ status: 'draft', title: 'New title' }),
    ),
    ...overrides,
  };
}

function request(body: unknown, eventId = 'evt-1') {
  return createTestEvent({
    method: 'PUT',
    url: `/api/v1/dashboard/events/${eventId}`,
    params: { eventId },
    body,
  }).event;
}

describe('PUT /api/v1/dashboard/events/:eventId', () => {
  it('authorizes against the event org, validates, and updates', async () => {
    const updateEvent = vi.fn(async () =>
      fakeEvent({ status: 'draft', title: 'New title' }),
    );
    const d = deps({ updateEvent });
    const event = request({ title: '  New title  ' });

    const result = await createDashboardEventsUpdateHandler(d)(event);

    expect(d.getEvent).toHaveBeenCalledWith('evt-1');
    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(updateEvent).toHaveBeenCalledWith('evt-1', { title: 'New title' });
    expect(result).toEqual({
      event: expect.objectContaining({ eventId: 'evt-1', title: 'New title' }),
    });
  });

  it('forwards a draft/published status change', async () => {
    const updateEvent = vi.fn(async () => fakeEvent({ status: 'published' }));
    const d = deps({ updateEvent });

    await createDashboardEventsUpdateHandler(d)(
      request({ status: 'published' }),
    );

    expect(updateEvent).toHaveBeenCalledWith('evt-1', {
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
    expect(d.requireOrgRole).not.toHaveBeenCalled();
    expect(d.updateEvent).not.toHaveBeenCalled();
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
    const event = request({ title: 'New title' });

    await expect(
      createDashboardEventsUpdateHandler(d)(event),
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
    expect(d.updateEvent).not.toHaveBeenCalled();
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
