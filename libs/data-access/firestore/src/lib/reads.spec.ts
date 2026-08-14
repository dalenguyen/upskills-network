import type { Guest } from '@upskills/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { at, seedEvent, seedGuest, seedOrg, seedUser } from '../testing/seed';
import { eventSlugRef, guestRef, orgSlugRef } from './collections';
import {
  findRegistrationsByEmail,
  getEvent,
  getEventBySlug,
  getGuest,
  getOrg,
  getOrgBySlug,
  getUser,
  listEventGuests,
  listOrgEvents,
  listPublishedEvents,
} from './reads';

beforeEach(clearFirestore);

describe('getUser', () => {
  it('returns the user with the doc id as its uid', async () => {
    await seedUser({ uid: 'uid-42', email: 'ada@example.com', name: 'Ada' });

    const user = await getUser('uid-42');

    expect(user).toMatchObject({
      uid: 'uid-42',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'user',
    });
    expect(user?.createdAt.toDate()).toBeInstanceOf(Date);
  });

  it('returns null for a missing user instead of throwing', async () => {
    await expect(getUser('nobody')).resolves.toBeNull();
  });
});

describe('getOrg / getOrgBySlug', () => {
  it('reads an organizer by id', async () => {
    await seedOrg({ orgId: 'org-9', name: 'Upskills Ottawa' });

    expect(await getOrg('org-9')).toMatchObject({
      orgId: 'org-9',
      name: 'Upskills Ottawa',
    });
  });

  it('resolves the slug through the orgSlugs reservation doc', async () => {
    await seedOrg({ orgId: 'org-9', slug: 'upskills-ottawa' });

    expect(await getOrgBySlug('upskills-ottawa')).toMatchObject({
      orgId: 'org-9',
    });
  });

  it('returns null for an unknown id or slug', async () => {
    await expect(getOrg('org-missing')).resolves.toBeNull();
    await expect(getOrgBySlug('never-reserved')).resolves.toBeNull();
  });

  it('returns null when a reservation points at a deleted organizer', async () => {
    await orgSlugRef('dangling').set({ orgId: 'org-gone' });

    await expect(getOrgBySlug('dangling')).resolves.toBeNull();
  });
});

describe('getEvent / getEventBySlug', () => {
  it('reads an event by id with the doc id as its eventId', async () => {
    await seedEvent({ eventId: 'evt-9', title: 'Advanced Networking' });

    expect(await getEvent('evt-9')).toMatchObject({
      eventId: 'evt-9',
      title: 'Advanced Networking',
      currency: 'cad',
      status: 'published',
    });
  });

  it('resolves the slug through the eventSlugs reservation doc', async () => {
    await seedEvent({ eventId: 'evt-9', slug: 'advanced-networking' });

    expect(await getEventBySlug('advanced-networking')).toMatchObject({
      eventId: 'evt-9',
      slug: 'advanced-networking',
    });
  });

  it('finds a draft event by slug — the lookup is not status-filtered', async () => {
    await seedEvent({ eventId: 'evt-draft', slug: 'secret', status: 'draft' });

    expect(await getEventBySlug('secret')).toMatchObject({ status: 'draft' });
  });

  it('returns null for an unknown id or slug', async () => {
    await expect(getEvent('evt-missing')).resolves.toBeNull();
    await expect(getEventBySlug('never-reserved')).resolves.toBeNull();
  });

  it('returns null when a reservation points at a deleted event', async () => {
    await eventSlugRef('dangling').set({ eventId: 'evt-gone' });

    await expect(getEventBySlug('dangling')).resolves.toBeNull();
  });
});

describe('listPublishedEvents', () => {
  /** Five published events, soonest first, plus two that must never appear. */
  async function seedBrowseFixtures(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await seedEvent({
        eventId: `evt-${i}`,
        slug: `event-${i}`,
        startsAt: at(i * 60),
      });
    }

    await seedEvent({ eventId: 'evt-draft', slug: 'draft', status: 'draft' });
    await seedEvent({
      eventId: 'evt-cancelled',
      slug: 'cancelled',
      status: 'cancelled',
    });
  }

  it('returns published events only, soonest first', async () => {
    await seedBrowseFixtures();

    const page = await listPublishedEvents();

    expect(page.events.map((event) => event.eventId)).toEqual([
      'evt-0',
      'evt-1',
      'evt-2',
      'evt-3',
      'evt-4',
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('advances through every event with the cursor, without repeats', async () => {
    await seedBrowseFixtures();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page = await listPublishedEvents({ cursor, limit: 2 });
      seen.push(...page.events.map((event) => event.eventId));
      cursor = page.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10); // guard against a cursor that never moves
    } while (cursor);

    expect(seen).toEqual(['evt-0', 'evt-1', 'evt-2', 'evt-3', 'evt-4']);
    expect(pages).toBe(3); // 2 + 2 + 1, the short page ends it
  });

  it('keeps paging stable when several events start at the same instant', async () => {
    for (const id of ['evt-a', 'evt-b', 'evt-c']) {
      await seedEvent({ eventId: id, slug: id, startsAt: at(0) });
    }

    const first = await listPublishedEvents({ limit: 2 });
    const second = await listPublishedEvents({
      cursor: first.nextCursor,
      limit: 2,
    });

    expect(
      [...first.events, ...second.events].map((event) => event.eventId),
    ).toEqual(['evt-a', 'evt-b', 'evt-c']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns an empty page when nothing is published', async () => {
    await seedEvent({ eventId: 'evt-draft', slug: 'draft', status: 'draft' });

    expect(await listPublishedEvents()).toEqual({
      events: [],
      nextCursor: null,
    });
  });

  it('rejects a malformed cursor', async () => {
    await expect(listPublishedEvents({ cursor: 'garbage' })).rejects.toThrow(
      'Invalid cursor',
    );
  });
});

describe('listOrgEvents', () => {
  it("returns one org's events newest first, including drafts", async () => {
    await seedEvent({
      eventId: 'evt-old',
      slug: 'old',
      orgId: 'org-1',
      startsAt: at(0),
    });
    await seedEvent({
      eventId: 'evt-new',
      slug: 'new',
      orgId: 'org-1',
      startsAt: at(120),
      status: 'draft',
    });
    await seedEvent({ eventId: 'evt-other', slug: 'other', orgId: 'org-2' });

    const events = await listOrgEvents('org-1');

    expect(events.map((event) => event.eventId)).toEqual([
      'evt-new',
      'evt-old',
    ]);
  });

  it('returns an empty array for an org with no events', async () => {
    await expect(listOrgEvents('org-empty')).resolves.toEqual([]);
  });
});

describe('listEventGuests', () => {
  it('lists guests in registration order', async () => {
    await seedEvent({ eventId: 'evt-1' });
    await seedGuest({
      eventId: 'evt-1',
      email: 'second@example.com',
      registeredAt: at(10),
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'first@example.com',
      registeredAt: at(5),
    });

    const guests = await listEventGuests('evt-1');

    expect(guests.map((guest) => guest.email)).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(guests[0]).toMatchObject({
      guestId: 'first@example.com',
      eventId: 'evt-1',
      status: 'confirmed',
    });
  });

  it('filters by status', async () => {
    await seedEvent({ eventId: 'evt-1' });
    await seedGuest({
      eventId: 'evt-1',
      email: 'in@example.com',
      status: 'confirmed',
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'waiting@example.com',
      status: 'pending',
      waitlistPosition: 1,
    });

    const pending = await listEventGuests('evt-1', { status: 'pending' });

    expect(pending.map((guest) => guest.email)).toEqual([
      'waiting@example.com',
    ]);
  });

  it('does not leak guests from another event', async () => {
    await seedGuest({ eventId: 'evt-1', email: 'mine@example.com' });
    await seedGuest({ eventId: 'evt-2', email: 'theirs@example.com' });

    expect(
      (await listEventGuests('evt-1')).map((guest) => guest.email),
    ).toEqual(['mine@example.com']);
  });

  it('returns an empty array for an event with no guests', async () => {
    await expect(listEventGuests('evt-empty')).resolves.toEqual([]);
  });
});

describe('getGuest', () => {
  it('reads the guest whose doc id is the normalized email', async () => {
    await seedGuest({
      eventId: 'evt-1',
      email: 'guest@example.com',
      name: 'Grace',
    });

    expect(await getGuest('evt-1', 'guest@example.com')).toMatchObject({
      guestId: 'guest@example.com',
      eventId: 'evt-1',
      name: 'Grace',
    });
  });

  it("normalizes the caller's email before building the doc id", async () => {
    await seedGuest({ eventId: 'evt-1', email: 'Guest@Example.com' });

    expect(await getGuest('evt-1', '  GUEST@example.COM ')).toMatchObject({
      guestId: 'guest@example.com',
    });
  });

  it('returns null when the guest is not registered', async () => {
    await expect(getGuest('evt-1', 'stranger@example.com')).resolves.toBeNull();
  });
});

describe('findRegistrationsByEmail', () => {
  it('finds every registration for one email across events, newest first', async () => {
    await seedGuest({
      eventId: 'evt-1',
      email: 'ada@example.com',
      registeredAt: at(0),
    });
    await seedGuest({
      eventId: 'evt-2',
      email: 'ada@example.com',
      registeredAt: at(60),
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'other@example.com',
      registeredAt: at(30),
    });

    const registrations = await findRegistrationsByEmail('ada@example.com');

    expect(registrations.map((guest) => guest.eventId)).toEqual([
      'evt-2',
      'evt-1',
    ]);
    expect(
      registrations.every((guest) => guest.email === 'ada@example.com'),
    ).toBe(true);
  });

  it("normalizes the caller's email", async () => {
    await seedGuest({ eventId: 'evt-1', email: 'ada@example.com' });

    expect(await findRegistrationsByEmail(' Ada@Example.COM ')).toHaveLength(1);
  });

  it('stamps the event id from the document path', async () => {
    // A guest doc written without the redundant `eventId` field still reports
    // the right event, because the path is the source of truth.
    await guestRef('evt-7', 'path@example.com').set({
      guestId: 'path@example.com',
      orgId: 'org-1',
      email: 'path@example.com',
      name: 'Path',
      status: 'confirmed',
      registeredAt: at(0),
      cancelToken: 'tok',
    } as unknown as Guest);

    const [registration] = await findRegistrationsByEmail('path@example.com');

    expect(registration.eventId).toBe('evt-7');
  });

  it('returns an empty array when the email never registered', async () => {
    await expect(
      findRegistrationsByEmail('nobody@example.com'),
    ).resolves.toEqual([]);
  });
});
