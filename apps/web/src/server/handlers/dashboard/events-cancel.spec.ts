import type { AuthContext, OrgContext } from '@upskills/auth';
import type { Guest } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeTimestamp,
} from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsCancelHandler,
  EMAIL_BATCH_SIZE,
  type DashboardEventsCancelDeps,
} from './events-cancel';

/** `DELETE /api/v1/dashboard/events/:eventId` — the organizer cancel route. */

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

function guest(overrides: Partial<Guest> = {}): Guest {
  return {
    guestId: 'ada@example.com',
    eventId: 'evt-1',
    orgId: 'org-1',
    email: 'ada@example.com',
    name: 'Ada',
    status: 'confirmed',
    registeredAt: fakeTimestamp(FIXTURE_START),
    cancelToken: 'tok-1',
    ...overrides,
  };
}

function deps(
  overrides: Partial<DashboardEventsCancelDeps> = {},
): DashboardEventsCancelDeps {
  return {
    requireAuth: vi.fn(async () => AUTH),
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent({ status: 'published' })),
    cancelEvent: vi.fn(async () => ({
      event: fakeEvent({ status: 'cancelled' }),
      confirmedGuests: [guest()],
    })),
    sendCancellationEmail: vi.fn(async () => ({
      sent: true as const,
      id: 'em_1',
    })),
    ...overrides,
  };
}

function request(eventId = 'evt-1') {
  return createTestEvent({
    method: 'DELETE',
    url: `/api/v1/dashboard/events/${eventId}`,
    params: { eventId },
  }).event;
}

describe('DELETE /api/v1/dashboard/events/:eventId', () => {
  it('cancels the event and notifies every confirmed guest', async () => {
    const first = guest();
    const second = guest({
      guestId: 'bob@example.com',
      email: 'bob@example.com',
      name: 'Bob',
    });
    const cancelEvent = vi.fn(async () => ({
      event: fakeEvent({ status: 'cancelled' }),
      confirmedGuests: [first, second],
    }));
    const sendCancellationEmail = vi.fn(async () => ({
      sent: true as const,
      id: 'em_1',
    }));
    const d = deps({ cancelEvent, sendCancellationEmail });
    const event = request();

    const result = await createDashboardEventsCancelHandler(d)(event);

    expect(d.getEvent).toHaveBeenCalledWith('evt-1');
    expect(d.requireOrgRole).toHaveBeenCalledWith(
      event,
      'org-1',
      'admin',
      'manager',
    );
    expect(cancelEvent).toHaveBeenCalledWith('evt-1');
    expect(sendCancellationEmail).toHaveBeenCalledTimes(2);
    expect(sendCancellationEmail).toHaveBeenNthCalledWith(
      1,
      first,
      expect.objectContaining({ eventId: 'evt-1', status: 'cancelled' }),
    );
    expect(sendCancellationEmail).toHaveBeenNthCalledWith(
      2,
      second,
      expect.objectContaining({ eventId: 'evt-1', status: 'cancelled' }),
    );
    expect(result).toEqual({
      event: expect.objectContaining({ eventId: 'evt-1', status: 'cancelled' }),
      notification: {
        attempted: 2,
        sent: 2,
        failed: 0,
        failures: [],
      },
    });
  });

  it('emails confirmed guests only, even if other statuses are returned', async () => {
    const held = guest({
      guestId: 'held@example.com',
      email: 'held@example.com',
      status: 'held',
    });
    const waiting = guest({
      guestId: 'waiting@example.com',
      email: 'waiting@example.com',
      status: 'pending',
      waitlistPosition: 1,
    });
    const alreadyCancelled = guest({
      guestId: 'cancelled@example.com',
      email: 'cancelled@example.com',
      status: 'cancelled',
    });
    const sendCancellationEmail = vi.fn(async () => ({
      sent: true as const,
      id: 'em_1',
    }));
    const d = deps({
      cancelEvent: vi.fn(async () => ({
        event: fakeEvent({ status: 'cancelled' }),
        confirmedGuests: [held, guest(), waiting, alreadyCancelled],
      })),
      sendCancellationEmail,
    });

    const result = await createDashboardEventsCancelHandler(d)(request());

    expect(sendCancellationEmail).toHaveBeenCalledOnce();
    expect(sendCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(result.notification).toEqual({
      attempted: 1,
      sent: 1,
      failed: 0,
      failures: [],
    });
  });

  it('keeps the cancellation standing and reports a failed send', async () => {
    const sendCancellationEmail = vi.fn(async () => ({
      sent: false as const,
      reason: 'unavailable' as const,
      detail: 'socket hang up',
    }));
    const d = deps({ sendCancellationEmail });

    const result = await createDashboardEventsCancelHandler(d)(request());

    expect(result.event).toMatchObject({
      eventId: 'evt-1',
      status: 'cancelled',
    });
    expect(result.notification).toEqual({
      attempted: 1,
      sent: 0,
      failed: 1,
      failures: [
        {
          email: 'ada@example.com',
          reason: 'unavailable',
          detail: 'socket hang up',
        },
      ],
    });
  });

  it('fans out in bounded batches rather than one unbounded Promise.all', async () => {
    const guestCount = EMAIL_BATCH_SIZE * 2 + 3;
    const confirmedGuests = Array.from({ length: guestCount }, (_, index) =>
      guest({
        guestId: `guest-${index}@example.com`,
        email: `guest-${index}@example.com`,
      }),
    );
    let active = 0;
    let maxActive = 0;
    const sendCancellationEmail = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { sent: true as const, id: 'em' };
    });
    const d = deps({
      cancelEvent: vi.fn(async () => ({
        event: fakeEvent({ status: 'cancelled' }),
        confirmedGuests,
      })),
      sendCancellationEmail,
    });

    const result = await createDashboardEventsCancelHandler(d)(request());

    expect(sendCancellationEmail).toHaveBeenCalledTimes(guestCount);
    expect(maxActive).toBe(EMAIL_BATCH_SIZE);
    expect(result.notification).toEqual({
      attempted: guestCount,
      sent: guestCount,
      failed: 0,
      failures: [],
    });
  });

  it('answers 403, not 404, for a missing event', async () => {
    const d = deps({ getEvent: vi.fn(async () => null) });

    await expect(
      createDashboardEventsCancelHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.requireOrgRole).not.toHaveBeenCalled();
    expect(d.cancelEvent).not.toHaveBeenCalled();
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
      createDashboardEventsCancelHandler(d)(event),
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
    expect(d.cancelEvent).not.toHaveBeenCalled();
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
      createDashboardEventsCancelHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.cancelEvent).not.toHaveBeenCalled();
  });

  it('answers 401 for a caller with no session before reading the event', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createDashboardEventsCancelHandler(d)(request()),
    ).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'expired' },
    });
    expect(d.getEvent).not.toHaveBeenCalled();
    expect(d.cancelEvent).not.toHaveBeenCalled();
  });

  it('answers 401 identically whether or not the event exists', async () => {
    const unauthenticated = () =>
      deps({
        requireAuth: vi.fn(async () => {
          throw fakeInvalidSessionError('expired');
        }),
      });

    const missing = unauthenticated();
    missing.getEvent = vi.fn(async () => null);
    const existing = unauthenticated();
    existing.getEvent = vi.fn(async () => fakeEvent({ status: 'published' }));

    for (const d of [missing, existing]) {
      await expect(
        createDashboardEventsCancelHandler(d)(request()),
      ).rejects.toMatchObject({
        statusCode: 401,
        data: { error: 'invalid-session', reason: 'expired' },
      });
      expect(d.getEvent).not.toHaveBeenCalled();
      expect(d.cancelEvent).not.toHaveBeenCalled();
    }
  });

  it('lets an unexpected write failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      cancelEvent: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createDashboardEventsCancelHandler(d)(request())).rejects.toBe(
      bug,
    );
  });
});
