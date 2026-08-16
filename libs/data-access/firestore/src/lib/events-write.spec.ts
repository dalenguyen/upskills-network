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

    const stored = await getEvent(created.eventId);
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
    expect((await eventSlugRef('react-basics').get()).data()).toEqual({
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
    expect(await getEvent(published.eventId)).toMatchObject({
      status: 'published',
    });
  });

  it('throws SlugTakenError for a taken slug and leaves no event behind', async () => {
    await seedEvent({ eventId: 'evt-existing', slug: 'taken' });

    await expect(
      createEvent('org-1', { ...draft, slug: 'taken' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    const docs = (await eventsCol().get()).docs.map((snapshot) =>
      snapshot.data(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ eventId: 'evt-existing', slug: 'taken' });
    expect((await eventSlugRef('taken').get()).data()).toEqual({
      eventId: 'evt-existing',
    });
  });
});

describe('updateEvent', () => {
  it('applies the patch, bumps updatedAt, and stores the result', async () => {
    await seedEvent({ eventId: 'evt-1' });
    const before = await getEvent('evt-1');

    const updated = await updateEvent('evt-1', {
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

    const stored = await getEvent('evt-1');
    expect(stored).toMatchObject({
      eventId: 'evt-1',
      title: 'Advanced React',
      maxGuests: 5,
    });
    expect(stored?.updatedAt.toMillis()).toBe(updated.updatedAt.toMillis());
  });

  it('releases the old slug and takes the new one atomically', async () => {
    await seedEvent({ eventId: 'evt-1', slug: 'old-slug' });

    const updated = await updateEvent('evt-1', { slug: '  new-slug  ' });

    expect(updated.slug).toBe('new-slug');
    expect(await getEvent('evt-1')).toMatchObject({ slug: 'new-slug' });
    expect((await eventSlugRef('old-slug').get()).exists).toBe(false);
    expect((await eventSlugRef('new-slug').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('keeps the original slug intact when the new slug collides', async () => {
    await seedEvent({ eventId: 'evt-1', slug: 'one' });
    await seedEvent({ eventId: 'evt-2', slug: 'two' });
    const before = await getEvent('evt-1');

    await expect(
      updateEvent('evt-1', { slug: 'two', title: 'Should Not Land' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    const stored = await getEvent('evt-1');
    expect(stored).toMatchObject({
      slug: 'one',
      title: 'Intro to Networking',
    });
    expect(stored?.updatedAt.toMillis()).toBe(before?.updatedAt.toMillis());
    expect((await eventSlugRef('one').get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await eventSlugRef('two').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('throws EventNotFoundError for a missing event', async () => {
    await expect(
      updateEvent('evt-gone', { title: 'Nope' }),
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

    const result = await cancelEvent('evt-1');

    expect(result.event).toMatchObject({
      eventId: 'evt-1',
      status: 'cancelled',
    });
    expect(result.confirmedGuests.map((guest) => guest.email).sort()).toEqual([
      'confirmed-1@example.com',
      'confirmed-2@example.com',
    ]);

    // The document stays in place; only its status changed.
    const stored = await getEvent('evt-1');
    expect(stored).toMatchObject({
      eventId: 'evt-1',
      title: 'Intro to Networking',
      status: 'cancelled',
    });
    expect(
      await listEventGuests('evt-1', { status: 'confirmed' }),
    ).toHaveLength(2);
  });

  it('throws EventNotFoundError for a missing event', async () => {
    await expect(cancelEvent('evt-gone')).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });
});
