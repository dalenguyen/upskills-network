import type { OrgContext } from '@upskills/auth';
import type { WorkshopEvent } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeSlugTakenError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsCreateHandler,
  type DashboardEventsCreateDeps,
} from './events-create';

/** `POST /api/v1/dashboard/events?orgId=` — the organizer event create route. */

const ORG: OrgContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'manager',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

const CREATE_BODY = {
  title: '  Workshop  ',
  slug: '  workshop  ',
  description: '  Hands-on  ',
  startsAt: '2026-09-01T18:00:00Z',
  timezone: 'UTC',
  location: '  Ottawa  ',
  price: 0,
  currency: 'cad',
  maxGuests: 30,
};

function deps(
  overrides: Partial<DashboardEventsCreateDeps> = {},
): DashboardEventsCreateDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    createEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    ...overrides,
  };
}

function request(body: unknown) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/dashboard/events?orgId=org-1',
    body,
  }).event;
}

describe('POST /api/v1/dashboard/events', () => {
  it('creates the event for the query org with the schema-normalized body', async () => {
    const createEvent = vi.fn(
      async (): Promise<WorkshopEvent> => fakeEvent({ status: 'draft' }),
    );
    const d = deps({ createEvent });
    const event = request(CREATE_BODY);

    const result = await createDashboardEventsCreateHandler(d)(event);

    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(createEvent).toHaveBeenCalledWith('org-1', {
      title: 'Workshop',
      slug: 'workshop',
      description: 'Hands-on',
      startsAt: '2026-09-01T18:00:00Z',
      timezone: 'UTC',
      location: 'Ottawa',
      price: 0,
      currency: 'cad',
      maxGuests: 30,
      status: 'draft',
    });
    expect(result).toEqual({
      event: expect.objectContaining({ eventId: 'evt-1', status: 'draft' }),
    });
  });

  it('answers 400 for a malformed body after authorization', async () => {
    const d = deps();

    await expect(
      createDashboardEventsCreateHandler(d)(request({ title: 'No slug' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-event' },
    });
    expect(d.requireOrgRole).toHaveBeenCalledOnce();
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('answers 401 for an unauthenticated caller even with a malformed body', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardEventsCreateHandler(d)(request({ title: 'No slug' })),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.createEvent).not.toHaveBeenCalled();
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
      createDashboardEventsCreateHandler(d)(request(CREATE_BODY)),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('answers 409 when the slug is already taken', async () => {
    const d = deps({
      createEvent: vi.fn(async () => {
        throw fakeSlugTakenError('workshop');
      }),
    });

    await expect(
      createDashboardEventsCreateHandler(d)(request(CREATE_BODY)),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'slug-taken' },
    });
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      createEvent: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(
      createDashboardEventsCreateHandler(d)(request(CREATE_BODY)),
    ).rejects.toBe(bug);
  });
});
