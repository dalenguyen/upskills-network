import type { EventStatus } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import { createEventDetailHandler, type EventDetailDeps } from './event-detail';

/**
 * `GET /api/v1/orgs/:orgSlug/events/:eventSlug`. The load-bearing test here is
 * the one proving a draft and a nonexistent slug are indistinguishable — see
 * the handler's comment for why that is a security property and not just
 * tidiness.
 */

/** The organizer every fixture in this file belongs to. */
const ORG_SLUG = 'upskills-toronto';

/** What `getEventByPath` resolves to, as one page. */
function page(event = fakeEvent()) {
  return { organizer: fakeOrg({ slug: ORG_SLUG }), event };
}

function deps(overrides: Partial<EventDetailDeps> = {}): EventDetailDeps {
  return {
    getEventByPath: vi.fn(async () => page()),
    ...overrides,
  };
}

function request(eventSlug = 'intro-to-networking', orgSlug = ORG_SLUG) {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/orgs/${orgSlug}/events/${eventSlug}`,
    params: { orgSlug, eventSlug },
  }).event;
}

describe('GET /api/v1/orgs/:orgSlug/events/:eventSlug', () => {
  it('returns the published event', async () => {
    const result = await createEventDetailHandler(deps())(request());

    expect(result).toMatchObject({
      event: { slug: 'intro-to-networking', title: 'Intro to Networking' },
    });
  });

  it('looks the event up by both slugs in the path', async () => {
    const getEventByPath = vi.fn(async () => page());

    await createEventDetailHandler(deps({ getEventByPath }))(
      request('advanced-networking', 'other-org'),
    );

    expect(getEventByPath).toHaveBeenCalledWith(
      'other-org',
      'advanced-networking',
    );
  });

  it('returns the organizer alongside the event', async () => {
    const result = await createEventDetailHandler(deps())(request());

    expect(result).toMatchObject({ org: { slug: ORG_SLUG } });
  });

  it('reports the organizer slug on the event, for building its URL', async () => {
    const result = await createEventDetailHandler(deps())(request());

    expect(result).toMatchObject({ event: { orgSlug: ORG_SLUG } });
  });

  it('answers 404 for a slug nobody has reserved', async () => {
    const d = deps({ getEventByPath: vi.fn(async () => null) });

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
        deps({ getEventByPath: vi.fn(async () => null) }),
      )(request()).catch((error: unknown) => error);

      const unpublished = await createEventDetailHandler(
        deps({
          getEventByPath: vi.fn(async () => page(fakeEvent({ status }))),
        }),
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
    const getEventByPath = vi.fn(async () => page());
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/orgs//events/',
    }).event;

    await expect(
      createEventDetailHandler(deps({ getEventByPath }))(event),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(getEventByPath).not.toHaveBeenCalled();
  });

  it('answers 404 when the organizer segment is missing', async () => {
    const getEventByPath = vi.fn(async () => page());
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/orgs//events/intro-to-networking',
      params: { eventSlug: 'intro-to-networking' },
    }).event;

    await expect(
      createEventDetailHandler(deps({ getEventByPath }))(event),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(getEventByPath).not.toHaveBeenCalled();
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      getEventByPath: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createEventDetailHandler(d)(request())).rejects.toBe(bug);
  });
});
