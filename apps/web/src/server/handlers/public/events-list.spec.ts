import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent } from '../../testing/public-fixtures';
import { createEventsListHandler, type EventsListDeps } from './events-list';

/** `GET /api/v1/events` — the public browse listing. */

function deps(overrides: Partial<EventsListDeps> = {}): EventsListDeps {
  return {
    listPublishedEvents: vi.fn(async () => ({
      events: [fakeEvent({ eventId: 'evt-1', slug: 'one' })],
      nextCursor: null,
    })),
    ...overrides,
  };
}

function request(query = '') {
  return createTestEvent({ method: 'GET', url: `/api/v1/events${query}` })
    .event;
}

describe('GET /api/v1/events', () => {
  it('returns a page of projected events', async () => {
    const result = await createEventsListHandler(deps())(request());

    expect(result).toEqual({
      events: [expect.objectContaining({ eventId: 'evt-1', slug: 'one' })],
      nextCursor: null,
    });
  });

  it('projects every event rather than returning the stored documents', async () => {
    const d = deps({
      listPublishedEvents: vi.fn(async () => ({
        events: [
          fakeEvent({ eventId: 'evt-1', slug: 'one', heldCount: 3 }),
          fakeEvent({ eventId: 'evt-2', slug: 'two', pendingCount: 9 }),
        ],
        nextCursor: null,
      })),
    });

    const result = (await createEventsListHandler(d)(request())) as {
      events: unknown[];
    };

    expect(JSON.stringify(result)).not.toContain('heldCount');
    expect(JSON.stringify(result)).not.toContain('pendingCount');
  });

  it('passes the cursor through and hands the next one back', async () => {
    const listPublishedEvents = vi.fn(async () => ({
      events: [fakeEvent()],
      nextCursor: 'cursor-2',
    }));

    const result = await createEventsListHandler(
      deps({ listPublishedEvents }),
    )(request('?cursor=cursor-1'));

    expect(listPublishedEvents).toHaveBeenCalledWith({ cursor: 'cursor-1' });
    expect(result).toMatchObject({ nextCursor: 'cursor-2' });
  });

  it('asks for the first page when no cursor is given', async () => {
    const listPublishedEvents = vi.fn(async () => ({
      events: [],
      nextCursor: null,
    }));

    await createEventsListHandler(deps({ listPublishedEvents }))(request());

    expect(listPublishedEvents).toHaveBeenCalledWith({ cursor: null });
  });

  it('forwards an explicit limit', async () => {
    const listPublishedEvents = vi.fn(async () => ({
      events: [],
      nextCursor: null,
    }));

    await createEventsListHandler(deps({ listPublishedEvents }))(
      request('?limit=5'),
    );

    expect(listPublishedEvents).toHaveBeenCalledWith({
      cursor: null,
      limit: 5,
    });
  });

  it('leaves an out-of-range limit to the read helper to clamp', async () => {
    const listPublishedEvents = vi.fn(async () => ({
      events: [],
      nextCursor: null,
    }));

    // 5000 has an obvious correct answer — the maximum page — so refusing the
    // request instead would be pedantry.
    await createEventsListHandler(deps({ listPublishedEvents }))(
      request('?limit=5000'),
    );

    expect(listPublishedEvents).toHaveBeenCalledWith({
      cursor: null,
      limit: 5000,
    });
  });

  it.each(['abc', '0', '-3', '2.5'])(
    'rejects limit=%s with a 400',
    async (limit) => {
      await expect(
        createEventsListHandler(deps())(request(`?limit=${limit}`)),
      ).rejects.toMatchObject({
        statusCode: 400,
        data: { error: 'invalid-limit' },
      });
    },
  );

  it('answers 400 for a malformed cursor instead of a 500', async () => {
    const d = deps({
      listPublishedEvents: vi.fn(async () => {
        throw new Error('Invalid cursor');
      }),
    });

    await expect(
      createEventsListHandler(d)(request('?cursor=garbage')),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-cursor' },
    });
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      listPublishedEvents: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createEventsListHandler(d)(request())).rejects.toBe(bug);
  });
});
