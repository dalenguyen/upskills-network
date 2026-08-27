import type { MediaObject } from '@upskills/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent } from '../../testing/public-fixtures';
import {
  MEDIA_SWEEP_SECRET_ENV,
  createMediaSweepHandler,
  type MediaSweepDeps,
} from './sweep-orphans';

/** `POST /api/v1/media/sweep` — the scheduled orphan sweep. */

const SECRET = 'sweep-secret-value';
const BUCKET = 'upskills-network-media';

/** Fixed clock, so "older than 24 hours" is a decision and not a race. */
const NOW = new Date('2026-08-27T12:00:00.000Z');

const HOUR_MS = 60 * 60 * 1000;

/** Comfortably outside the 24-hour grace. */
const OLD = new Date(NOW.getTime() - 48 * HOUR_MS);

/** Comfortably inside it. */
const FRESH = new Date(NOW.getTime() - 1 * HOUR_MS);

function urlFor(path: string): string {
  return `https://storage.googleapis.com/${BUCKET}/${path}`;
}

function object(path: string, createdAt: Date): MediaObject {
  return { path, createdAt };
}

function deps(overrides: Partial<MediaSweepDeps> = {}): MediaSweepDeps {
  return {
    storage: {
      upload: vi.fn(async () => ''),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    },
    listEvents: vi.fn(async () => []),
    now: () => NOW,
    ...overrides,
  };
}

/**
 * Omit the header entirely. Spelled as its own value rather than `undefined`,
 * because passing `undefined` to a defaulted parameter selects the default —
 * an earlier version of this file did exactly that and "no secret header"
 * silently sent the correct one, so the test passed the guard it claimed to
 * defeat.
 */
const NO_HEADER = Symbol('no sweep secret header');

function request(secret: string | typeof NO_HEADER = SECRET) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/media/sweep',
    headers: secret === NO_HEADER ? {} : { 'x-sweep-secret': secret },
  }).event;
}

describe('POST /api/v1/media/sweep', () => {
  beforeEach(() => {
    process.env[MEDIA_SWEEP_SECRET_ENV] = SECRET;
  });

  afterEach(() => {
    delete process.env[MEDIA_SWEEP_SECRET_ENV];
  });

  describe('the shared-secret guard', () => {
    it('refuses a request with no secret header and deletes nothing', async () => {
      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: vi.fn(async () => undefined),
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/orphan.jpg', OLD),
          ]),
        },
      });

      await expect(
        createMediaSweepHandler(d)(request(NO_HEADER)),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(d.storage.delete).not.toHaveBeenCalled();
    });

    it('refuses a wrong secret and deletes nothing', async () => {
      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: vi.fn(async () => undefined),
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/orphan.jpg', OLD),
          ]),
        },
      });

      await expect(
        createMediaSweepHandler(d)(request('not-the-secret')),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(d.storage.delete).not.toHaveBeenCalled();
    });

    it('accepts the correct secret', async () => {
      await expect(
        createMediaSweepHandler(deps())(request()),
      ).resolves.toMatchObject({ scanned: 0, deleted: 0 });
    });
  });

  describe('the 24-hour grace period', () => {
    it('deletes an unreferenced object older than 24 hours', async () => {
      const del = vi.fn(async () => undefined);
      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/orphan.jpg', OLD),
          ]),
        },
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 1,
        spared: 0,
      });

      expect(del).toHaveBeenCalledWith('orgs/org-1/event-media/orphan.jpg');
    });

    it('leaves an unreferenced object younger than 24 hours alone', async () => {
      const del = vi.fn(async () => undefined);
      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/just-uploaded.jpg', FRESH),
          ]),
        },
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 0,
        spared: 1,
      });

      expect(del).not.toHaveBeenCalled();
    });

    it('spares an object exactly at the boundary and deletes one just past it', async () => {
      const del = vi.fn(async () => undefined);
      const atBoundary = new Date(NOW.getTime() - 24 * HOUR_MS);
      const pastBoundary = new Date(NOW.getTime() - 24 * HOUR_MS - 1);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/at.jpg', atBoundary),
            object('orgs/org-1/event-media/past.jpg', pastBoundary),
          ]),
        },
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 2,
        deleted: 1,
        spared: 1,
      });

      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith('orgs/org-1/event-media/past.jpg');
    });
  });

  describe('an object an event references is never deleted', () => {
    // The regression this whole design turns on. Editing any field of an event
    // that has an uploaded hero image drops `heroImage` while `imageUrl` still
    // points at the live object, so a sweep keyed on `heroImage.storagePath`
    // would delete a published event's image 24 hours after its first edit.
    it('spares an object named only by imageUrl, with no heroImage at all', async () => {
      const path = 'orgs/org-1/event-media/live.jpg';
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [object(path, OLD)]),
        },
        listEvents: vi.fn(async () => [
          fakeEvent({ imageUrl: urlFor(path), heroImage: undefined }),
        ]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 0,
        spared: 1,
      });

      expect(del).not.toHaveBeenCalled();
    });

    it('spares an object named only by heroImage.storagePath', async () => {
      const path = 'orgs/org-1/event-media/bookkept.jpg';
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [object(path, OLD)]),
        },
        listEvents: vi.fn(async () => [
          fakeEvent({
            imageUrl: 'https://example.com/pasted.jpg',
            heroImage: {
              storagePath: path,
              contentType: 'image/jpeg',
              sizeBytes: 1024,
              uploadedAt: NOW.toISOString(),
            },
          }),
        ]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 0,
        spared: 1,
      });

      expect(del).not.toHaveBeenCalled();
    });

    it('spares referenced objects regardless of event status', async () => {
      const draft = 'orgs/org-1/event-media/draft.jpg';
      const cancelled = 'orgs/org-1/event-media/cancelled.jpg';
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [object(draft, OLD), object(cancelled, OLD)]),
        },
        listEvents: vi.fn(async () => [
          fakeEvent({ status: 'draft', imageUrl: urlFor(draft) }),
          fakeEvent({ status: 'cancelled', imageUrl: urlFor(cancelled) }),
        ]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 2,
        deleted: 0,
        spared: 2,
      });

      expect(del).not.toHaveBeenCalled();
    });

    it('still collects a genuine orphan while sparing a referenced sibling', async () => {
      const live = 'orgs/org-1/event-media/live.jpg';
      const orphan = 'orgs/org-1/event-media/orphan.jpg';
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [object(live, OLD), object(orphan, OLD)]),
        },
        listEvents: vi.fn(async () => [fakeEvent({ imageUrl: urlFor(live) })]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 2,
        deleted: 1,
        spared: 1,
      });

      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith(orphan);
    });
  });

  describe('failing safe', () => {
    it('ignores a pasted external link without sparing or deleting on its account', async () => {
      const orphan = 'orgs/org-1/event-media/orphan.jpg';
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [object(orphan, OLD)]),
        },
        listEvents: vi.fn(async () => [
          fakeEvent({ imageUrl: 'https://example.com/elsewhere.jpg' }),
        ]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 1,
        spared: 0,
      });

      expect(del).toHaveBeenCalledWith(orphan);
    });

    it('deletes nothing when an imageUrl cannot be parsed', async () => {
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/orphan.jpg', OLD),
          ]),
        },
        listEvents: vi.fn(async () => [fakeEvent({ imageUrl: 'not a url' })]),
      });

      await expect(createMediaSweepHandler(d)(request())).resolves.toEqual({
        scanned: 1,
        deleted: 0,
        spared: 1,
      });

      expect(del).not.toHaveBeenCalled();
    });

    it('deletes nothing when the event read fails', async () => {
      const del = vi.fn(async () => undefined);

      const d = deps({
        storage: {
          upload: vi.fn(async () => ''),
          delete: del,
          list: vi.fn(async () => [
            object('orgs/org-1/event-media/orphan.jpg', OLD),
          ]),
        },
        listEvents: vi.fn(async () => {
          throw new Error('firestore unavailable');
        }),
      });

      await expect(createMediaSweepHandler(d)(request())).rejects.toThrow();

      expect(del).not.toHaveBeenCalled();
    });
  });
});
