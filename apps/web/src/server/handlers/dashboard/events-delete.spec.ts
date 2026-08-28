import type { AuthContext, OrgContext } from '@upskills/auth';
import type { MediaStorage, UploadMediaInput } from '@upskills/storage';
import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventsDeleteHandler,
  type DashboardEventsDeleteDeps,
} from './events-delete';

/** `DELETE /api/v1/dashboard/events/:eventId/permanent` — the hard delete route. */

const ORG: OrgContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'admin',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

const AUTH: AuthContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as AuthContext['session'],
};

function mediaStorage(overrides: Partial<MediaStorage> = {}): MediaStorage {
  return {
    upload: vi.fn(
      async (input: UploadMediaInput) =>
        `https://storage.googleapis.com/test-bucket/${input.path}`,
    ),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    ...overrides,
  };
}

function deps(
  overrides: Partial<DashboardEventsDeleteDeps> = {},
): DashboardEventsDeleteDeps {
  return {
    requireAuth: vi.fn(async () => AUTH),
    requireOrgRole: vi.fn(async () => ORG),
    getEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    deleteDraftEvent: vi.fn(async () => undefined),
    storage: mediaStorage(),
    mediaBucketName: vi.fn(() => 'test-bucket'),
    ...overrides,
  };
}

function request(eventId = 'evt-1', orgId = 'org-1') {
  return createTestEvent({
    method: 'DELETE',
    url: `/api/v1/dashboard/events/${eventId}/permanent?orgId=${orgId}`,
    params: { eventId },
  }).event;
}

describe('DELETE /api/v1/dashboard/events/:eventId/permanent', () => {
  it('deletes the uploaded hero image object after the event document is gone', async () => {
    const objectPath = 'orgs/org-1/event-media/abc.jpg';
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl: `https://storage.googleapis.com/test-bucket/${objectPath}`,
        }),
      ),
    });

    const result = await createDashboardEventsDeleteHandler(d)(request());

    expect(d.deleteDraftEvent).toHaveBeenCalledWith('org-1', 'evt-1');
    expect(d.storage.delete).toHaveBeenCalledOnce();
    expect(d.storage.delete).toHaveBeenCalledWith(objectPath);
    expect(result).toEqual({
      eventId: 'evt-1',
      slug: 'intro-to-networking',
      deleted: true,
    });
  });

  it('touches no bucket object for a pasted external image URL', async () => {
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl: 'https://images.example.com/x.jpg',
        }),
      ),
    });

    const result = await createDashboardEventsDeleteHandler(d)(request());

    expect(d.storage.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      eventId: 'evt-1',
      slug: 'intro-to-networking',
      deleted: true,
    });
  });

  it('touches no bucket object owned by a different org', async () => {
    // `imageUrl` is organizer-supplied and every event's object URL is public,
    // so being inside our own bucket does not make the object this caller's to
    // delete. Without the org-prefix check an admin of org-1 could point a
    // throwaway draft at org-2's image and destroy it by deleting the draft.
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl:
            'https://storage.googleapis.com/test-bucket/orgs/org-2/event-media/victim.jpg',
        }),
      ),
    });

    const result = await createDashboardEventsDeleteHandler(d)(request());

    expect(d.storage.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      eventId: 'evt-1',
      slug: 'intro-to-networking',
      deleted: true,
    });
  });

  it('touches no bucket object outside the event-media prefix', async () => {
    // Within the caller's own org, but not something this route mints. Only an
    // uploaded hero image is its to delete; anything else that later lives
    // under an org's path would otherwise be destroyable by pointing a
    // throwaway draft at it.
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl:
            'https://storage.googleapis.com/test-bucket/orgs/org-1/org-logo/logo.png',
        }),
      ),
    });

    await createDashboardEventsDeleteHandler(d)(request());

    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('touches no bucket object when the caller is not authenticated', async () => {
    const denied = new Error('unauthorized');
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw denied;
      }),
    });

    await expect(
      createDashboardEventsDeleteHandler(d)(request()),
    ).rejects.toBeDefined();
    expect(d.deleteDraftEvent).not.toHaveBeenCalled();
    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('touches no bucket object when the caller is not an org admin', async () => {
    const denied = new Error('forbidden');
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw denied;
      }),
    });

    await expect(
      createDashboardEventsDeleteHandler(d)(request()),
    ).rejects.toBeDefined();
    expect(d.deleteDraftEvent).not.toHaveBeenCalled();
    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('touches no bucket object when the event does not exist', async () => {
    const d = deps({ getEvent: vi.fn(async () => null) });

    await expect(
      createDashboardEventsDeleteHandler(d)(request()),
    ).rejects.toBeDefined();
    expect(d.deleteDraftEvent).not.toHaveBeenCalled();
    expect(d.storage.delete).not.toHaveBeenCalled();
  });

  it('touches no bucket object when the event has no image URL', async () => {
    const d = deps({
      getEvent: vi.fn(async () => fakeEvent({ status: 'draft' })),
    });

    const result = await createDashboardEventsDeleteHandler(d)(request());

    expect(d.mediaBucketName).not.toHaveBeenCalled();
    expect(d.storage.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      eventId: 'evt-1',
      slug: 'intro-to-networking',
      deleted: true,
    });
  });

  it('still succeeds when the object delete fails, logging the failure', async () => {
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl:
            'https://storage.googleapis.com/test-bucket/orgs/org-1/event-media/abc.jpg',
        }),
      ),
      storage: mediaStorage({
        delete: vi.fn(async () => {
          throw new Error('bucket unavailable');
        }),
      }),
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const result = await createDashboardEventsDeleteHandler(d)(request());

      expect(d.storage.delete).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalled();
      expect(result).toEqual({
        eventId: 'evt-1',
        slug: 'intro-to-networking',
        deleted: true,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('touches no bucket object when the event document delete fails', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      getEvent: vi.fn(async () =>
        fakeEvent({
          status: 'draft',
          imageUrl:
            'https://storage.googleapis.com/test-bucket/orgs/org-1/event-media/abc.jpg',
        }),
      ),
      deleteDraftEvent: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createDashboardEventsDeleteHandler(d)(request())).rejects.toBe(
      bug,
    );
    expect(d.storage.delete).not.toHaveBeenCalled();
  });
});
