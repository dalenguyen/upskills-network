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
 *
 * ## The auth routes are testable here, and only here
 *
 * `@upskills/auth` cannot be *imported* under Vitest — `firebase-admin/auth`
 * reaches `jwks-rsa`, which `require()`s `jose`, which ships ESM from a package
 * marked CommonJS (see `alias-smoke.spec.ts`). That is why the handlers take
 * their dependencies by injection and the route files hold the only static
 * import.
 *
 * `vi.mock` with a factory replaces the module before anything resolves it, so
 * the real one is never loaded and the limitation does not apply. The auth
 * routes' wiring has therefore been untested purely by assumption, not by
 * necessity — a gap codemagpieai flagged on #86 and which was merged without
 * being closed.
 */

const firestore = vi.hoisted(() => ({
  listPublishedEvents: vi.fn(async () => ({ events: [], nextCursor: null })),
  listPublishedOrgEvents: vi.fn(async () => ({ events: [], nextCursor: null })),
  listOrgEvents: vi.fn(async () => []),
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
  addWaitlistSubscriber: vi.fn(async () => 'subscribed'),
  createUserIfAbsent: vi.fn(async () => ({
    user: { uid: 'uid-1', role: 'user' },
    created: false,
  })),
  getUser: vi.fn(async () => null),
  getOrg: vi.fn(async () => null),
  listOrgs: vi.fn(async () => []),
  createOrg: vi.fn(async () => ({})),
  createEvent: vi.fn(async () => ({})),
  updateEvent: vi.fn(async () => ({})),
  setOrgMember: vi.fn(async () => ({})),
  removeOrgMember: vi.fn(async () => ({})),
}));

const email = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendWaitlistEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendCancellationEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendSpotOpenedEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
  sendWaitlistConfirmationEmail: vi.fn(async () => ({ sent: true, id: 'em' })),
}));

const auth = vi.hoisted(() => ({
  createSessionCookie: vi.fn(async () => ({
    name: '__session',
    value: 'minted-cookie',
    attributes: { httpOnly: true, maxAge: 60 },
  })),
  verifySessionCookie: vi.fn(async () => ({
    uid: 'uid-1',
    email: 'ada@example.com',
    admin: false,
    expiresAt: new Date(),
    claims: {},
  })),
  revokeSessions: vi.fn(async () => undefined),
  clearedSessionCookie: vi.fn(() => '__session=; Max-Age=0'),
  requireAuth: vi.fn(async () => ({ uid: 'uid-1', role: 'user' })),
  requireAdmin: vi.fn(async () => ({ uid: 'uid-1', role: 'admin' })),
  requireOrgRole: vi.fn(async () => ({
    uid: 'uid-1',
    role: 'user',
    session: {},
    orgId: 'org-1',
    orgRole: 'admin',
    viaPlatformAdmin: false,
    org: { orgId: 'org-1' },
  })),
}));

vi.mock('@upskills/firestore', () => firestore);
vi.mock('@upskills/email', () => email);
vi.mock('@upskills/auth', () => auth);

import { createTestEvent } from './testing/h3-event';

import meGetRoute from './routes/api/v1/auth/me.get';
import sessionDeleteRoute from './routes/api/v1/auth/session.delete';
import sessionPostRoute from './routes/api/v1/auth/session.post';
import cancelRoute from './routes/api/v1/registration/[eventId]/cancel.post';
import eventDetailRoute from './routes/api/v1/events/[slug].get';
import eventsListRoute from './routes/api/v1/events/index.get';
import orgDetailRoute from './routes/api/v1/orgs/[orgSlug].get';
import registerRoute from './routes/api/v1/registration/[eventId]/register.post';
import waitlistPostRoute from './routes/api/v1/waitlist.post';

import adminOrgsListRoute from './routes/api/v1/admin/orgs/index.get';
import adminOrgsCreateRoute from './routes/api/v1/admin/orgs/index.post';
import adminOrgDetailRoute from './routes/api/v1/admin/orgs/[orgId]/index.get';
import adminOrgMembersPostRoute from './routes/api/v1/admin/orgs/[orgId]/members.post';
import adminOrgMembersPutRoute from './routes/api/v1/admin/orgs/[orgId]/members.put';
import adminOrgMembersDeleteRoute from './routes/api/v1/admin/orgs/[orgId]/members.delete';

import dashboardEventsListRoute from './routes/api/v1/dashboard/events/index.get';
import dashboardEventsCreateRoute from './routes/api/v1/dashboard/events/index.post';
import dashboardEventDetailRoute from './routes/api/v1/dashboard/events/[eventId]/index.get';
import dashboardEventUpdateRoute from './routes/api/v1/dashboard/events/[eventId]/index.put';

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

describe('waitlist route wiring', () => {
  it('POST /waitlist forwards the normalized email and sends the confirmation', async () => {
    await run(waitlistPostRoute, {
      method: 'POST',
      url: '/api/v1/waitlist',
      body: { email: 'Ada@Example.com' },
    });

    expect(firestore.addWaitlistSubscriber).toHaveBeenCalledWith(
      'ada@example.com',
    );
    expect(email.sendWaitlistConfirmationEmail).toHaveBeenCalledWith(
      'ada@example.com',
    );
  });
});

describe('auth route wiring', () => {
  it('POST /auth/session exchanges the body idToken and creates the user doc', async () => {
    firestore.createUserIfAbsent.mockResolvedValueOnce({
      user: { uid: 'uid-1', role: 'user' },
      created: true,
    } as never);

    await run(sessionPostRoute, {
      method: 'POST',
      url: '/api/v1/auth/session',
      body: { idToken: 'id-token-from-client' },
    });

    expect(auth.createSessionCookie).toHaveBeenCalledWith(
      'id-token-from-client',
    );
    // The cookie is verified before the user document is touched, and it is the
    // *minted* cookie that is verified — not the raw idToken.
    expect(auth.verifySessionCookie).toHaveBeenCalledWith('minted-cookie');
    expect(firestore.createUserIfAbsent).toHaveBeenCalled();
  });

  it('GET /auth/me reads the user named by the session', async () => {
    await run(meGetRoute, { method: 'GET', url: '/api/v1/auth/me' });

    expect(auth.requireAuth).toHaveBeenCalled();
    expect(firestore.getUser).toHaveBeenCalledWith('uid-1');
  });

  it('DELETE /auth/session revokes the caller, not a body-supplied uid', async () => {
    // The uid comes from the verified session and nowhere else. A route that
    // read it off the request would let anyone sign out anyone.
    await run(sessionDeleteRoute, {
      method: 'DELETE',
      url: '/api/v1/auth/session',
      body: { uid: 'uid-victim' },
    });

    expect(auth.requireAuth).toHaveBeenCalled();
    expect(auth.revokeSessions).toHaveBeenCalledWith('uid-1');
    expect(auth.revokeSessions).not.toHaveBeenCalledWith('uid-victim');
  });
});

describe('admin org route wiring', () => {
  it('GET /admin/orgs requires an admin and lists orgs', async () => {
    await run(adminOrgsListRoute, {
      method: 'GET',
      url: '/api/v1/admin/orgs',
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.listOrgs).toHaveBeenCalled();
  });

  it('POST /admin/orgs creates the org with the authenticated admin as creator', async () => {
    await run(adminOrgsCreateRoute, {
      method: 'POST',
      url: '/api/v1/admin/orgs',
      body: { name: 'Upskills Ottawa', slug: 'upskills-ottawa' },
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.createOrg).toHaveBeenCalledWith({
      name: 'Upskills Ottawa',
      slug: 'upskills-ottawa',
      createdBy: 'uid-1',
    });
  });

  it('GET /admin/orgs/:orgId requires an admin and reads by org id', async () => {
    firestore.getOrg.mockResolvedValueOnce({ orgId: 'org-1' } as never);

    await run(adminOrgDetailRoute, {
      method: 'GET',
      url: '/api/v1/admin/orgs/org-1',
      params: { orgId: 'org-1' },
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.getOrg).toHaveBeenCalledWith('org-1');
  });

  it('POST /admin/orgs/:orgId/members sets the role from the body', async () => {
    await run(adminOrgMembersPostRoute, {
      method: 'POST',
      url: '/api/v1/admin/orgs/org-1/members',
      params: { orgId: 'org-1' },
      body: { uid: 'uid-2', role: 'manager' },
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.setOrgMember).toHaveBeenCalledWith(
      'org-1',
      'uid-2',
      'manager',
    );
  });

  it('PUT /admin/orgs/:orgId/members changes the role from the body', async () => {
    await run(adminOrgMembersPutRoute, {
      method: 'PUT',
      url: '/api/v1/admin/orgs/org-1/members',
      params: { orgId: 'org-1' },
      body: { uid: 'uid-2', role: 'check_in' },
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.setOrgMember).toHaveBeenCalledWith(
      'org-1',
      'uid-2',
      'check_in',
    );
  });

  it('DELETE /admin/orgs/:orgId/members removes the uid from the body', async () => {
    await run(adminOrgMembersDeleteRoute, {
      method: 'DELETE',
      url: '/api/v1/admin/orgs/org-1/members',
      params: { orgId: 'org-1' },
      body: { uid: 'uid-2' },
    });

    expect(auth.requireAdmin).toHaveBeenCalled();
    expect(firestore.removeOrgMember).toHaveBeenCalledWith('org-1', 'uid-2');
  });
});

describe('dashboard event route wiring', () => {
  it('GET /dashboard/events requires an org role and lists the query org id', async () => {
    await run(dashboardEventsListRoute, {
      method: 'GET',
      url: '/api/v1/dashboard/events?orgId=org-1',
    });

    expect(auth.requireOrgRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'admin',
      'manager',
    );
    expect(firestore.listOrgEvents).toHaveBeenCalledWith('org-1');
  });

  it('POST /dashboard/events requires an org role and creates with the query org id', async () => {
    await run(dashboardEventsCreateRoute, {
      method: 'POST',
      url: '/api/v1/dashboard/events?orgId=org-1',
      body: {
        title: '  Workshop  ',
        slug: '  workshop  ',
        description: 'Hands-on',
        startsAt: '2026-09-01T18:00:00Z',
        timezone: 'UTC',
        price: 0,
        currency: 'cad',
        maxGuests: 30,
      },
    });

    expect(auth.requireOrgRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'admin',
      'manager',
    );
    expect(firestore.createEvent).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        title: 'Workshop',
        slug: 'workshop',
        status: 'draft',
      }),
    );
  });

  it('GET /dashboard/events/:eventId reads the event then authorizes its org', async () => {
    firestore.getEvent.mockResolvedValueOnce({
      eventId: 'evt-1',
      orgId: 'org-1',
    } as never);

    await run(dashboardEventDetailRoute, {
      method: 'GET',
      url: '/api/v1/dashboard/events/evt-1',
      params: { eventId: 'evt-1' },
    });

    expect(firestore.getEvent).toHaveBeenCalledWith('evt-1');
    expect(auth.requireOrgRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'admin',
      'manager',
    );
  });

  it('PUT /dashboard/events/:eventId updates after reading the event', async () => {
    firestore.getEvent.mockResolvedValueOnce({
      eventId: 'evt-1',
      orgId: 'org-1',
    } as never);

    await run(dashboardEventUpdateRoute, {
      method: 'PUT',
      url: '/api/v1/dashboard/events/evt-1',
      params: { eventId: 'evt-1' },
      body: { title: 'New title' },
    });

    expect(firestore.getEvent).toHaveBeenCalledWith('evt-1');
    expect(auth.requireOrgRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'admin',
      'manager',
    );
    expect(firestore.updateEvent).toHaveBeenCalledWith('evt-1', {
      title: 'New title',
    });
  });
});
