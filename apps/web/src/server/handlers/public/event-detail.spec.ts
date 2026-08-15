import type { EventStatus } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent } from '../../testing/public-fixtures';
import { createEventDetailHandler, type EventDetailDeps } from './event-detail';

/**
 * `GET /api/v1/events/:slug`. The load-bearing test here is the one proving a
 * draft and a nonexistent slug are indistinguishable — see the handler's
 * comment for why that is a security property and not just tidiness.
 */

function deps(overrides: Partial<EventDetailDeps> = {}): EventDetailDeps {
  return {
    getEventBySlug: vi.fn(async () => fakeEvent()),
    ...overrides,
  };
}

function request(slug = 'intro-to-networking') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/events/${slug}`,
    params: { slug },
  }).event;
}

describe('GET /api/v1/events/:slug', () => {
  it('returns the published event', async () => {
    const result = await createEventDetailHandler(deps())(request());

    expect(result).toMatchObject({
      event: { slug: 'intro-to-networking', title: 'Intro to Networking' },
    });
  });

  it('looks the event up by the slug in the path', async () => {
    const getEventBySlug = vi.fn(async () => fakeEvent());

    await createEventDetailHandler(deps({ getEventBySlug }))(
      request('advanced-networking'),
    );

    expect(getEventBySlug).toHaveBeenCalledWith('advanced-networking');
  });

  it('answers 404 for a slug nobody has reserved', async () => {
    const d = deps({ getEventBySlug: vi.fn(async () => null) });

    await expect(
      createEventDetailHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'event-not-found' },
    });
  });

  it.each<EventStatus>(['draft', 'cancelled'])(
    'answers 404 for a %s event, byte-identically to a missing one',
    async (status) => {
      const missing = await createEventDetailHandler(
        deps({ getEventBySlug: vi.fn(async () => null) }),
      )(request()).catch((error: unknown) => error);

      const unpublished = await createEventDetailHandler(
        deps({ getEventBySlug: vi.fn(async () => fakeEvent({ status })) }),
      )(request()).catch((error: unknown) => error);

      // Anything that differs — status, code, even the prose — is a signal a
      // caller could use to confirm an unannounced event exists.
      expect({
        statusCode: (unpublished as { statusCode: number }).statusCode,
        statusMessage: (unpublished as { statusMessage: string }).statusMessage,
        message: (unpublished as { message: string }).message,
        data: (unpublished as { data: unknown }).data,
      }).toEqual({
        statusCode: (missing as { statusCode: number }).statusCode,
        statusMessage: (missing as { statusMessage: string }).statusMessage,
        message: (missing as { message: string }).message,
        data: (missing as { data: unknown }).data,
      });
    },
  );

  it('answers 404 when the router matched no slug at all', async () => {
    const getEventBySlug = vi.fn(async () => fakeEvent());
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/events/',
    }).event;

    await expect(
      createEventDetailHandler(deps({ getEventBySlug }))(event),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(getEventBySlug).not.toHaveBeenCalled();
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      getEventBySlug: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createEventDetailHandler(d)(request())).rejects.toBe(bug);
  });
});
