import { describe, expect, it, vi } from 'vitest';

/**
 * What the route files themselves do — which is nothing but wiring, and is
 * exactly why it needs its own test.
 *
 * Every route under `routes/api/**` is a thin default export that injects real
 * library functions into a handler factory. The handler specs next door prove
 * the behavior, but they prove it against stubs: they cannot see a route that
 * forwards the wrong parameter, injects the wrong dependency, or — the one that
 * actually costs money — passes `'hold'` where it meant `'confirm'`. Every one
 * of those leaves the whole handler suite green and the app broken.
 *
 * The libraries are mocked at the module boundary, so nothing here reaches
 * Firestore or Resend, and `@upskills/firestore` is never really loaded.
 *
 * This file lives in `src/server/` rather than beside the routes on purpose:
 * anything under `src/server/routes/` is claimed by the file-based router, and
 * a spec dropped in there would be published as an endpoint.
 */

const firestore = vi.hoisted(() => ({
  listPublishedEvents: vi.fn(async () => ({ events: [], nextCursor: null })),
  listPublishedOrgEvents: vi.fn(async () => ({ events: [], nextCursor: null })),
  getEventBySlug: vi.fn(async () => null),
  getOrgBySlug: vi.fn(async () => null),
  getEvent: vi.fn(async () => null),
  getGuest: vi.fn(async () => null),
  reserveSpot: vi.fn(async () => ({
    outcome: 'confirmed',
    alreadyRegistered: false,
    guest: {},
  })),
  cancelGuest: vi.fn(async () => ({ changed: false, guest: null })),
  promoteNextPending: vi.fn(async () => null),
}));

const email = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendWaitlistEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendCancellationEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendSpotOpenedEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
}));

vi.mock('@upskills/firestore', () => firestore);
vi.mock('@upskills/email', () => email);

import { createTestEvent } from './testing/h3-event';

import cancelRoute from './routes/api/v1/registration/[eventId]/cancel.post';
import eventDetailRoute from './routes/api/v1/events/[slug].get';
import eventsListRoute from './routes/api/v1/events/index.get';
import orgDetailRoute from './routes/api/v1/orgs/[orgSlug].get';
import registerRoute from './routes/api/v1/registration/[eventId]/register.post';

/** Run a route, ignoring whatever it throws — only the wiring is under test. */
async function run(
  handler: (event: ReturnType<typeof createTestEvent>['event']) => unknown,
  init: Parameters<typeof createTestEvent>[0],
): Promise<void> {
  await Promise.resolve(handler(createTestEvent(init).event)).catch(() => {
    /* a 404 from a stub returning null is expected and irrelevant here */
  });
}

describe('public route wiring', () => {
  it('GET /events forwards the cursor to listPublishedEvents', async () => {
    await run(eventsListRoute, {
      method: 'GET',
      url: '/api/v1/events?cursor=abc',
    });

    expect(firestore.listPublishedEvents).toHaveBeenCalledWith({
      cursor: 'abc',
    });
  });

  it('GET /events/:slug forwards the slug to getEventBySlug', async () => {
    await run(eventDetailRoute, {
      method: 'GET',
      url: '/api/v1/events/some-slug',
      params: { slug: 'some-slug' },
    });

    expect(firestore.getEventBySlug).toHaveBeenCalledWith('some-slug');
  });

  it('GET /orgs/:orgSlug forwards the org slug to getOrgBySlug', async () => {
    await run(orgDetailRoute, {
      method: 'GET',
      url: '/api/v1/orgs/some-org',
      params: { orgSlug: 'some-org' },
    });

    expect(firestore.getOrgBySlug).toHaveBeenCalledWith('some-org');
  });
});

describe('registration route wiring', () => {
  it('reserves in confirm mode, never hold', async () => {
    firestore.getEvent.mockResolvedValueOnce({
      eventId: 'evt-1',
      price: 0,
    } as never);

    await run(registerRoute, {
      method: 'POST',
      url: '/api/v1/registration/evt-1/register',
      params: { eventId: 'evt-1' },
      body: { email: 'ada@example.com', name: 'Ada' },
    });

    // The literal that separates a free confirmation from a Stripe hold. No
    // handler spec can see it: they inject their own reserveSpot.
    expect(firestore.reserveSpot).toHaveBeenCalledWith(
      'evt-1',
      { email: 'ada@example.com', name: 'Ada' },
      'confirm',
    );
  });

  it('cancel forwards the event id and the normalized email', async () => {
    firestore.getGuest.mockResolvedValueOnce({
      cancelToken: 'tok-1',
    } as never);
    firestore.getEvent.mockResolvedValueOnce({ eventId: 'evt-1' } as never);

    await run(cancelRoute, {
      method: 'POST',
      url: '/api/v1/registration/evt-1/cancel',
      params: { eventId: 'evt-1' },
      body: { email: 'Ada@Example.com', cancelToken: 'tok-1' },
    });

    expect(firestore.cancelGuest).toHaveBeenCalledWith(
      'evt-1',
      'ada@example.com',
    );
    expect(firestore.promoteNextPending).toHaveBeenCalledWith('evt-1');
  });
});
