import type { AuthContext, OrgContext } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeGuest, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsGuestsHandler,
  type DashboardEventsGuestsDeps,
} from './events-guests';

/** `GET /api/v1/dashboard/events/:eventId/guests` — the organizer guest list. */

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
  overrides: Partial<DashboardEventsGuestsDeps> = {},
): DashboardEventsGuestsDeps {
  return {
    requireAuth: vi.fn(async () => AUTH),
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent()),
    listEventGuests: vi.fn(async () => [fakeGuest()]),
    ...overrides,
  };
}

function request(eventId = 'evt-1', orgId = 'org-1') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/dashboard/events/${eventId}/guests?orgId=${orgId}`,
    params: { eventId },
  }).event;
}

describe('GET /api/v1/dashboard/events/:eventId/guests', () => {
  it('authorizes the ?orgId= org, reads the event, and returns the guest list', async () => {
    const listEventGuests = vi.fn(async () => [
      fakeGuest({ name: 'Ada Lovelace', status: 'confirmed' }),
    ]);
    const d = deps({ listEventGuests });
    const event = request();

    const result = await createDashboardEventsGuestsHandler(d)(event);

    expect(d.getEvent).toHaveBeenCalledWith('org-1', 'evt-1');
    expect(listEventGuests).toHaveBeenCalledWith('org-1', 'evt-1');
    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(result).toEqual({
      guests: [
        expect.objectContaining({ name: 'Ada Lovelace', status: 'confirmed' }),
      ],
    });
  });

  it('never puts an email or a doc id on the wire', async () => {
    const d = deps({
      listEventGuests: vi.fn(async () => [
        fakeGuest({ email: 'guest@example.com', guestId: 'guest@example.com' }),
      ]),
    });

    const result = (await createDashboardEventsGuestsHandler(d)(request())) as {
      guests: Record<string, unknown>[];
    };

    expect(result.guests[0]).not.toHaveProperty('email');
    expect(result.guests[0]).not.toHaveProperty('guestId');
  });

  it('serializes every timestamp as an ISO-8601 string', async () => {
    const d = deps({
      listEventGuests: vi.fn(async () => [
        fakeGuest({
          checkedInAt: fakeGuest().registeredAt,
        }),
      ]),
    });

    const result = (await createDashboardEventsGuestsHandler(d)(request())) as {
      guests: Record<string, unknown>[];
    };

    for (const field of ['registeredAt', 'checkedInAt'] as const) {
      expect(typeof result.guests[0][field]).toBe('string');
      expect(new Date(result.guests[0][field] as string).toISOString()).toBe(
        result.guests[0][field],
      );
    }
  });

  it('answers 403, not 404, for a missing event', async () => {
    const getEvent = vi.fn(async () => null);
    const listEventGuests = vi.fn(async () => []);
    const d = deps({ getEvent, listEventGuests });

    await expect(
      createDashboardEventsGuestsHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(getEvent).toHaveBeenCalledWith('org-1', 'nope');
    expect(listEventGuests).not.toHaveBeenCalled();
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
      createDashboardEventsGuestsHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
  });

  it('answers 401 for a caller with no session, before the event is read', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardEventsGuestsHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.getEvent).not.toHaveBeenCalled();
  });
});
