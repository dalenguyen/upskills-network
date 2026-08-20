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
    const createEvent = vi.fn(async (): Promise<WorkshopEvent> =>
      fakeEvent({ status: 'draft' }),
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
      createdBy: 'uid-manager',
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

  it('stamps createdBy from the session uid, never from the request body', async () => {
    const createEvent = vi.fn(async (): Promise<WorkshopEvent> =>
      fakeEvent({ status: 'draft' }),
    );
    const d = deps({ createEvent });

    await createDashboardEventsCreateHandler(d)(
      request({ ...CREATE_BODY, createdBy: 'uid-from-body' }),
    );

    expect(createEvent).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ createdBy: 'uid-manager' }),
    );
  });

  // A Firestore `Timestamp` serializes to `{_seconds,_nanoseconds}` — an object
  // with no `toDate()`. Returning the raw document would type-check against
  // `WorkshopEvent` and then throw `startsAt.toDate is not a function` in the
  // browser, so the conversion is the contract, not an implementation detail.
  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps();

    const result = (await createDashboardEventsCreateHandler(d)(
      request(CREATE_BODY),
    )) as Awaited<
      ReturnType<ReturnType<typeof createDashboardEventsCreateHandler>>
    >;

    const workshop = (result as { event: Record<string, unknown> }).event;

    for (const field of ['startsAt', 'createdAt', 'updatedAt'] as const) {
      expect(typeof workshop[field]).toBe('string');
      expect(new Date(workshop[field] as string).toISOString()).toBe(
        workshop[field],
      );
    }
  });

  it('answers 400 for a malformed body after authorization', async () => {
    const d = deps();

    await expect(
      createDashboardEventsCreateHandler(d)(request({ title: 'No slug' })),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-event' },
      message: expect.stringContaining('slug'),
    });
    expect(d.requireOrgRole).toHaveBeenCalledOnce();
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('names the endsAt/startsAt ordering violation in the 400 message', async () => {
    const d = deps();

    await expect(
      createDashboardEventsCreateHandler(d)(
        request({
          ...CREATE_BODY,
          startsAt: '2026-09-01T18:00:00Z',
          endsAt: '2026-09-01T17:00:00Z',
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-event' },
      message: expect.stringContaining('endsAt'),
    });
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
