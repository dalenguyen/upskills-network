import type { Guest, Organizer, User, WorkshopEvent } from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';
import { Timestamp } from 'firebase-admin/firestore';
import {
  eventRef,
  eventSlugRef,
  guestRef,
  orgRef,
  orgSlugRef,
  userRef,
} from '../lib/collections';

/**
 * Fixture writers for emulator-backed tests.
 *
 * Each one fills in a complete, valid document, applies your overrides on top,
 * writes it, and returns exactly what was written — so a test only has to name
 * the fields it is actually asserting on. They also maintain the invariants a
 * real write path would: seeding an org or an event reserves its slug doc too.
 *
 * These are test-only and are deliberately **not** exported from the library
 * index; import them by relative path from a spec file.
 */

/** Fixed clock, so ordering assertions are deterministic. */
export const T0 = Timestamp.fromDate(new Date('2026-09-01T18:00:00.000Z'));

/** `T0` plus `minutes`, for building an explicit ordering between fixtures. */
export function at(minutes: number): Timestamp {
  return Timestamp.fromMillis(T0.toMillis() + minutes * 60_000);
}

export async function seedUser(overrides: Partial<User> = {}): Promise<User> {
  const user: User = {
    uid: 'uid-1',
    email: 'organizer@example.com',
    name: 'Ada',
    role: 'user',
    orgIds: ['org-1'],
    createdAt: T0,
    ...overrides,
  };

  await userRef(user.uid).set(user);
  return user;
}

export async function seedOrg(
  overrides: Partial<Organizer> = {},
): Promise<Organizer> {
  const org: Organizer = {
    orgId: 'org-1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-1',
    members: { 'uid-1': { role: 'admin', addedAt: T0 } },
    memberUids: ['uid-1'],
    createdAt: T0,
    ...overrides,
  };

  await orgRef(org.orgId).set(org);
  await orgSlugRef(org.slug).set({ orgId: org.orgId });
  return org;
}

export async function seedEvent(
  overrides: Partial<WorkshopEvent> = {},
): Promise<WorkshopEvent> {
  const event: WorkshopEvent = {
    eventId: 'evt-1',
    orgId: 'org-1',
    title: 'Intro to Networking',
    slug: 'intro-to-networking',
    description: 'A hands-on session.',
    startsAt: T0,
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 30,
    confirmedCount: 0,
    heldCount: 0,
    pendingCount: 0,
    status: 'published',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };

  await eventRef(event.eventId).set(event);
  await eventSlugRef(event.slug).set({ eventId: event.eventId });
  return event;
}

export async function seedGuest(
  overrides: Partial<Guest> = {},
): Promise<Guest> {
  const email = normalizeEmail(overrides.email ?? 'guest@example.com');
  const guest: Guest = {
    eventId: 'evt-1',
    orgId: 'org-1',
    name: 'Grace',
    status: 'confirmed',
    registeredAt: T0,
    confirmedAt: T0,
    cancelToken: 'tok_abc123',
    ...overrides,
    // The doc id is derived from the email, so these two cannot be overridden
    // into disagreeing with each other.
    email,
    guestId: email,
  };

  await guestRef(guest.eventId, guest.email).set(guest);
  return guest;
}
