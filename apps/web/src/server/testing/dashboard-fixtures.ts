import type { OrgContext } from '@upskills/auth';
import type { Guest } from '@upskills/models';
import { fakeOrg } from './public-fixtures';
import { fakeTimestamp } from './fakes';

/**
 * Complete in-memory fixtures for the dashboard handler specs.
 *
 * `OrgContext` carries a `SessionUser` whose `claims` is a full Firebase
 * `DecodedIdToken`; the handlers under test never read it, so the cast keeps
 * the fixture readable without weakening the surrounding types.
 */

export const DASHBOARD_UID = 'uid-1';

export function dashboardOrgContext(
  overrides: Partial<OrgContext> = {},
): OrgContext {
  return {
    uid: DASHBOARD_UID,
    role: 'user',
    session: {
      uid: DASHBOARD_UID,
      admin: false,
      expiresAt: new Date('2026-01-07T00:00:00.000Z'),
      claims: {} as unknown as OrgContext['session']['claims'],
    },
    orgId: 'org-1',
    orgRole: 'admin',
    viaPlatformAdmin: false,
    org: fakeOrg(),
    ...overrides,
  };
}

export function dashboardGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    guestId: 'ada@example.com',
    eventId: 'evt-1',
    orgId: 'org-1',
    email: 'ada@example.com',
    name: 'Ada',
    status: 'confirmed',
    registeredAt: fakeTimestamp(new Date('2026-09-01T18:00:00.000Z')),
    cancelToken: 'tok_1',
    ...overrides,
  };
}
