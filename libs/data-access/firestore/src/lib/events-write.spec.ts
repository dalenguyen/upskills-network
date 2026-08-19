import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent, seedGuest } from '../testing/seed';
import { eventSlugRef, eventsCol } from './collections';
import {
  cancelEvent,
  createEvent,
  updateEvent,
  type CreateEventDraft,
} from './events-write';
import { getEvent, listEventGuests } from './reads';
import { SlugTakenError } from './slugs';
import { EventNotFoundError } from './transactions';

beforeEach(clearFirestore);

const draft: CreateEventDraft = {
  title: '  React Basics  ',
  slug: '  react-basics  ',
  createdBy: 'uid-1',
  description: '  A hands-on session.  ',
  startsAt: '2026-09-01T18:00:00.000Z',
  timezone: 'America/Toronto',
  price: 2500,
  currency: 'cad',
  maxGuests: 30,
};

describe('createEvent', () => {
  it('writes the event and its slug reservation together', async () => {
    const created = await createEvent('org-1', draft);

    expect(created).toMatchObject({
      orgId: 'org-1',
      createdBy: 'uid-1',
      title: 'React Basics',
      slug: 'react-basics',
      description: 'A hands-on session.',
      price: 2500,
      currency: 'cad',
      maxGuests: 30,
      status: 'draft',
      confirmedCount: 0,
      heldCount: 0,
      pendingCount: 0,
    });
    expect(created.createdAt.toDate()).toBeInstanceOf(Date);
    expect(created.updatedAt.toMillis()).toBe(created.createdAt.toMillis());

    const stored = await getEvent('org-1', created.eventId);
    expect(stored).toMatchObject({
      eventId: created.eventId,
      orgId: 'org-1',
      createdBy: 'uid-1',
      title: 'React Basics',
      slug: 'react-basics',
      status: 'draft',
      confirmedCount: 0,
      heldCount: 0,
      pendingCount: 0,
    });
    expect((await eventSlugRef('org-1', 'react-basics').get()).data()).toEqual({
      eventId: created.eventId,
    });
  });

  it('defaults status to draft and accepts published from the input', async () => {
    const published = await createEvent('org-1', {
      ...draft,
      slug: 'published-event',
      status: 'published',
    });

    expect(published.status).toBe('published');
    expect(await getEvent('org-1', published.eventId)).toMatchObject({
      status: 'published',
    });
  });

  it('stores the community-listing fields, trimmed', async () => {
    const listed = await createEvent('org-1', {
      ...draft,
      slug: 'toronto-ai-meetup',
      externalUrl: '  https://example.com/events/toronto-ai  ',
      sourceName: '  Meetup  ',
      imageUrl: '  https://example.com/poster.jpg  ',
    });

    expect(await getEvent('org-1', listed.eventId)).toMatchObject({
      externalUrl: 'https://example.com/events/toronto-ai',
      sourceName: 'Meetup',
      imageUrl: 'https://example.com/poster.jpg',
    });
  });

  it('omits the community-listing fields entirely when they are not given', async () => {
    // Absent, not empty. `externalUrl`'s mere presence is what refuses a
    // registration, so a stored `''` would be a different question than the one
    // every reader asks.
    const created = await createEvent('org-1', { ...draft, slug: 'plain' });
    const stored = await getEvent('org-1', created.eventId);

    expect(stored && 'externalUrl' in stored).toBe(false);
    expect(stored && 'sourceName' in stored).toBe(false);
    expect(stored && 'imageUrl' in stored).toBe(false);
  });

  it('throws SlugTakenError for a taken slug and leaves no event behind', async () => {
    await seedEvent({ eventId: 'evt-existing', slug: 'taken' });

    await expect(
      createEvent('org-1', { ...draft, slug: 'taken' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    const docs = (await eventsCol('org-1').get()).docs.map((snapshot) =>
      snapshot.data(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ eventId: 'evt-existing', slug: 'taken' });
    expect((await eventSlugRef('org-1', 'taken').get()).data()).toEqual({
      eventId: 'evt-existing',
    });
  });
});

describe('updateEvent', () => {
  it('applies the patch, bumps updatedAt, and stores the result', async () => {
    await seedEvent({ eventId: 'evt-1' });
    const before = await getEvent('org-1', 'evt-1');

    const updated = await updateEvent('org-1', 'evt-1', {
      title: '  Advanced React  ',
      maxGuests: 5,
    });

    expect(updated).toMatchObject({
      eventId: 'evt-1',
      title: 'Advanced React',
      maxGuests: 5,
      slug: 'intro-to-networking',
    });
    expect(updated.updatedAt.toMillis()).not.toBe(before?.updatedAt.toMillis());

    const stored = await getEvent('org-1', 'evt-1');
    expect(stored).toMatchObject({
      eventId: 'evt-1',
      title: 'Advanced React',
      maxGuests: 5,
    });
    expect(stored?.updatedAt.toMillis()).toBe(updated.updatedAt.toMillis());
  });

  it('releases the old slug and takes the new one atomically', async () => {
    await seedEvent({ eventId: 'evt-1', slug: 'old-slug' });

    const updated = await updateEvent('org-1', 'evt-1', {
      slug: '  new-slug  ',
    });

    expect(updated.slug).toBe('new-slug');
    expect(await getEvent('org-1', 'evt-1')).toMatchObject({
      slug: 'new-slug',
    });
    expect((await eventSlugRef('org-1', 'old-slug').get()).exists).toBe(false);
    expect((await eventSlugRef('org-1', 'new-slug').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('keeps the original slug intact when the new slug collides', async () => {
    await seedEvent({ eventId: 'evt-1', slug: 'one' });
    await seedEvent({ eventId: 'evt-2', slug: 'two' });
    const before = await getEvent('org-1', 'evt-1');

    await expect(
      updateEvent('org-1', 'evt-1', { slug: 'two', title: 'Should Not Land' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    const stored = await getEvent('org-1', 'evt-1');
    expect(stored).toMatchObject({
      slug: 'one',
      title: 'Intro to Networking',
    });
    expect(stored?.updatedAt.toMillis()).toBe(before?.updatedAt.toMillis());
    expect((await eventSlugRef('org-1', 'one').get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await eventSlugRef('org-1', 'two').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('sets an image, and removes it again when passed an empty string', async () => {
    await seedEvent({ eventId: 'evt-1', slug: 'react-basics' });

    await updateEvent('org-1', 'evt-1', {
      imageUrl: 'https://example.com/poster.jpg',
    });
    expect(await getEvent('org-1', 'evt-1')).toMatchObject({
      imageUrl: 'https://example.com/poster.jpg',
    });

    // The key is deleted rather than set to `''` — an organizer who pasted the
    // wrong URL has to be able to get back to having no image at all.
    await updateEvent('org-1', 'evt-1', { imageUrl: '' });
    const cleared = await getEvent('org-1', 'evt-1');
    expect(cleared && 'imageUrl' in cleared).toBe(false);
  });

  it('leaves the listing fields alone when the patch does not mention them', async () => {
    // This is what makes a seeded event survive an edit through the dashboard,
    // whose form has no input for either field.
    await seedEvent({
      eventId: 'evt-1',
      slug: 'react-basics',
      externalUrl: 'https://example.com/events/toronto-ai',
      sourceName: 'Meetup',
    });

    await updateEvent('org-1', 'evt-1', { title: 'Renamed' });

    expect(await getEvent('org-1', 'evt-1')).toMatchObject({
      title: 'Renamed',
      externalUrl: 'https://example.com/events/toronto-ai',
      sourceName: 'Meetup',
    });
  });

  it('throws EventNotFoundError for a missing event', async () => {
    await expect(
      updateEvent('org-1', 'evt-gone', { title: 'Nope' }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('cancelEvent', () => {
  it('soft-deletes the event and returns only its confirmed guests', async () => {
    await seedEvent({ eventId: 'evt-1' });
    await seedGuest({
      eventId: 'evt-1',
      email: 'confirmed-1@example.com',
      status: 'confirmed',
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'confirmed-2@example.com',
      status: 'confirmed',
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'held@example.com',
      status: 'held',
    });
    await seedGuest({
      eventId: 'evt-1',
      email: 'waiting@example.com',
      status: 'pending',
      waitlistPosition: 1,
    });

    const result = await cancelEvent('org-1', 'evt-1');

    expect(result.event).toMatchObject({
      eventId: 'evt-1',
      status: 'cancelled',
    });
    expect(result.confirmedGuests.map((guest) => guest.email).sort()).toEqual([
      'confirmed-1@example.com',
      'confirmed-2@example.com',
    ]);

    // The document stays in place; only its status changed.
    const stored = await getEvent('org-1', 'evt-1');
    expect(stored).toMatchObject({
      eventId: 'evt-1',
      title: 'Intro to Networking',
      status: 'cancelled',
    });
    expect(
      await listEventGuests('org-1', 'evt-1', { status: 'confirmed' }),
    ).toHaveLength(2);
  });

  it('throws EventNotFoundError for a missing event', async () => {
    await expect(cancelEvent('org-1', 'evt-gone')).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });
});
