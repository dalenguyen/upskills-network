import type { OrgContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsListHandler,
  type DashboardEventsListDeps,
} from './events-list';

/** `GET /api/v1/dashboard/events?orgId=` — the organizer dashboard listing. */

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
  overrides: Partial<DashboardEventsListDeps> = {},
): DashboardEventsListDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    listOrgEvents: vi.fn(async () => [fakeEvent({ status: 'draft' })]),
    ...overrides,
  };
}

function request(query = '?orgId=org-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/dashboard/events${query}`,
  }).event;
}

describe('GET /api/v1/dashboard/events', () => {
  it('requires an org role and lists every status', async () => {
    const d = deps();
    const event = request();

    const result = await createDashboardEventsListHandler(d)(event);

    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(d.listOrgEvents).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({
      events: [expect.objectContaining({ eventId: 'evt-1', status: 'draft' })],
    });
  });

  // A Firestore `Timestamp` serializes to `{_seconds,_nanoseconds}` — an object
  // with no `toDate()`. Returning the raw document would type-check against
  // `WorkshopEvent` and then throw `startsAt.toDate is not a function` in the
  // browser, so the conversion is the contract, not an implementation detail.
  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps();

    const result = (await createDashboardEventsListHandler(d)(
      request(),
    )) as Awaited<
      ReturnType<ReturnType<typeof createDashboardEventsListHandler>>
    >;

    const [workshop] = (result as { events: Record<string, unknown>[] }).events;

    for (const field of ['startsAt', 'createdAt', 'updatedAt'] as const) {
      expect(typeof workshop[field]).toBe('string');
      expect(new Date(workshop[field] as string).toISOString()).toBe(
        workshop[field],
      );
    }
  });

  it('answers 400 for a missing org id', async () => {
    const d = deps();

    await expect(
      createDashboardEventsListHandler(d)(request('')),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-org-id' },
    });
    expect(d.requireOrgRole).not.toHaveBeenCalled();
    expect(d.listOrgEvents).not.toHaveBeenCalled();
  });

  it('answers 403 for a member without an allowed role', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeForbiddenError(
          'One of [admin, manager] in org "org-1" is required.',
        );
      }),
    });

    await expect(
      createDashboardEventsListHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.listOrgEvents).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardEventsListHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      listOrgEvents: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createDashboardEventsListHandler(d)(request())).rejects.toBe(
      bug,
    );
  });
});
