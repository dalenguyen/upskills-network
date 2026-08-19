import type {
  OrgInvite,
  Organizer,
  User,
  WorkshopEvent,
} from '@upskills/models';
import { fakeTimestamp } from './fakes';

/**
 * Complete, valid `WorkshopEvent` and `Organizer` values for handler specs.
 *
 * These build documents in memory — the public routes only read, so a spec
 * hands its stub read a fixture and never touches Firestore. Emulator-backed
 * coverage of the reads themselves lives in `libs/data-access/firestore`; these
 * exercise the projection and the HTTP behavior on top of them.
 *
 * Each fills in every required field and applies overrides on top, so a spec
 * names only what it asserts on.
 */

/** Fixed clock, so ISO strings in assertions are literals. */
export const FIXTURE_START = new Date('2026-09-01T18:00:00.000Z');

export function fakeEvent(
  overrides: Partial<WorkshopEvent> = {},
): WorkshopEvent {
  return {
    eventId: 'evt-1',
    orgId: 'org-1',
    createdBy: 'uid-1',
    title: 'Intro to Networking',
    slug: 'intro-to-networking',
    description: 'A hands-on session.',
    startsAt: fakeTimestamp(FIXTURE_START),
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 30,
    confirmedCount: 0,
    heldCount: 0,
    pendingCount: 0,
    status: 'published',
    createdAt: fakeTimestamp(FIXTURE_START),
    updatedAt: fakeTimestamp(FIXTURE_START),
    ...overrides,
  };
}

export function fakeOrg(overrides: Partial<Organizer> = {}): Organizer {
  return {
    orgId: 'org-1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-1',
    members: {
      'uid-1': { role: 'admin', addedAt: fakeTimestamp(FIXTURE_START) },
    },
    memberUids: ['uid-1'],
    createdAt: fakeTimestamp(FIXTURE_START),
    ...overrides,
  };
}

/**
 * One `users/{uid}` document — what `findUserByEmail` answers when a member is
 * named by email. `uid-1` is the same member `fakeOrg` puts on the roster, so a
 * spec can add "the user behind the fixture org's admin" without restating it.
 */
export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-1',
    email: 'ada@example.com',
    role: 'user',
    orgIds: ['org-1'],
    createdAt: fakeTimestamp(FIXTURE_START),
    ...overrides,
  };
}

/** uid → email for the `fakeOrg` roster, as `getUserEmails` answers it. */
export const FIXTURE_EMAILS: Record<string, string> = {
  'uid-1': 'ada@example.com',
};

/** One outstanding invitation, expiring a week after the fixture clock. */
export function fakeInvite(overrides: Partial<OrgInvite> = {}): OrgInvite {
  return {
    inviteId: 'inv-1',
    orgId: 'org-1',
    email: 'grace@example.com',
    role: 'manager',
    token: 'tok-1',
    invitedBy: 'uid-1',
    createdAt: fakeTimestamp(FIXTURE_START),
    expiresAt: fakeTimestamp(
      new Date(FIXTURE_START.getTime() + 7 * 24 * 60 * 60 * 1000),
    ),
    ...overrides,
  };
}
