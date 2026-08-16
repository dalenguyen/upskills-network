import type { DashboardEvent, MeGetResponse } from '../dashboard-api';

/**
 * Shared fixtures for the dashboard page specs.
 *
 * Both pages read the same two endpoints and therefore need the same two
 * shapes. Keeping one copy means a field added to `MeGetResponse` or
 * `DashboardEvent` is a single edit rather than two that can drift apart —
 * and drift here is quiet, because a spec that builds a stale shape still
 * compiles until the missing field is actually read.
 */

/** A caller who belongs to exactly one org, as `GET /api/v1/auth/me` answers. */
export const meResponse: MeGetResponse = {
  user: {
    uid: 'user_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  orgs: [
    {
      orgId: 'org_1',
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      role: 'admin',
    },
  ],
};

/**
 * One event as the dashboard route serializes it.
 *
 * The three timestamps are ISO-8601 strings, not `Timestamp`s — that is the
 * wire format `toDashboardEvent` produces, and building them any other way
 * would let a spec pass against a shape the browser never actually receives.
 */
export function workshop(
  overrides: Partial<DashboardEvent> = {},
): DashboardEvent {
  return {
    eventId: 'evt_1',
    orgId: 'org_1',
    createdBy: 'user_1',
    title: 'Intro to Kubernetes',
    slug: 'intro-to-kubernetes',
    description: 'A hands-on afternoon.',
    startsAt: '2026-09-10T13:30:00.000Z',
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 20,
    confirmedCount: 5,
    heldCount: 0,
    pendingCount: 0,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
