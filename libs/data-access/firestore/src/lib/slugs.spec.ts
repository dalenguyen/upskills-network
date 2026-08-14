import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent, seedOrg } from '../testing/seed';
import { eventSlugRef, orgSlugRef } from './collections';
import { getEventBySlug, getOrgBySlug } from './reads';
import {
  InvalidSlugError,
  SlugTakenError,
  releaseSlug,
  renameSlug,
  reserveSlug,
} from './slugs';

/**
 * Issue #34 — single-threaded behaviour of the slug reservations. The race
 * itself lives in `slugs.concurrency.spec.ts`; everything here is about what
 * one caller at a time is told, and about the documents left behind.
 */

beforeEach(clearFirestore);

describe('reserveSlug', () => {
  it('writes the reservation shape the slug readers expect', async () => {
    await reserveSlug('eventSlugs', 'react-basics', 'evt-1');
    await reserveSlug('orgSlugs', 'upskills-yyz', 'org-1');

    expect((await eventSlugRef('react-basics').get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await orgSlugRef('upskills-yyz').get()).data()).toEqual({
      orgId: 'org-1',
    });
  });

  it('makes the slug resolvable through the O(1) read path', async () => {
    await seedOrg({ orgId: 'org-x', slug: 'seeded-org' });
    await seedEvent({ eventId: 'evt-x', orgId: 'org-x', slug: 'seeded-event' });

    // A slug the fixtures never reserved: only this call can make it resolve.
    await reserveSlug('orgSlugs', 'org-alias', 'org-x');
    await reserveSlug('eventSlugs', 'event-alias', 'evt-x');

    expect((await getOrgBySlug('org-alias'))?.orgId).toBe('org-x');
    expect((await getEventBySlug('event-alias'))?.eventId).toBe('evt-x');
  });

  it('returns the slug it stored, trimmed', async () => {
    expect(await reserveSlug('eventSlugs', '  react-basics  ', 'evt-1')).toBe(
      'react-basics',
    );
    expect((await eventSlugRef('react-basics').get()).exists).toBe(true);
  });

  it('rejects a second owner with a typed error, not a gRPC failure', async () => {
    await reserveSlug('eventSlugs', 'react-basics', 'evt-1');

    const failure = await reserveSlug(
      'eventSlugs',
      'react-basics',
      'evt-2',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SlugTakenError);
    expect(failure).toMatchObject({
      collection: 'eventSlugs',
      slug: 'react-basics',
      heldBy: 'evt-1',
    });
    // The loser changed nothing.
    expect((await eventSlugRef('react-basics').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('is idempotent for the owner that already holds it', async () => {
    await reserveSlug('eventSlugs', 'react-basics', 'evt-1');

    await expect(
      reserveSlug('eventSlugs', 'react-basics', 'evt-1'),
    ).resolves.toBe('react-basics');
    expect((await eventSlugRef('react-basics').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('keeps the two collections independent', async () => {
    await reserveSlug('orgSlugs', 'shared-name', 'org-1');

    // Same slug, different namespace: /org/shared-name and /events/shared-name
    // are different URLs and must not collide.
    await expect(
      reserveSlug('eventSlugs', 'shared-name', 'evt-1'),
    ).resolves.toBe('shared-name');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['uppercase', 'React-Basics'],
    ['a path separator', 'react/basics'],
    ['spaces inside', 'react basics'],
  ])('rejects %s with InvalidSlugError', async (_label, slug) => {
    await expect(reserveSlug('eventSlugs', slug, 'evt-1')).rejects.toThrow(
      InvalidSlugError,
    );
  });
});

describe('renameSlug', () => {
  it('frees the old slug and takes the new one', async () => {
    await reserveSlug('eventSlugs', 'old-name', 'evt-1');

    expect(
      await renameSlug('eventSlugs', 'evt-1', {
        from: 'old-name',
        to: 'new-name',
      }),
    ).toBe('new-name');

    expect((await eventSlugRef('old-name').get()).exists).toBe(false);
    expect((await eventSlugRef('new-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('leaves the freed slug available to somebody else', async () => {
    await reserveSlug('eventSlugs', 'old-name', 'evt-1');
    await renameSlug('eventSlugs', 'evt-1', {
      from: 'old-name',
      to: 'new-name',
    });

    await expect(reserveSlug('eventSlugs', 'old-name', 'evt-2')).resolves.toBe(
      'old-name',
    );
    expect((await eventSlugRef('old-name').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('refuses a slug another owner holds and keeps the old one intact', async () => {
    await reserveSlug('eventSlugs', 'old-name', 'evt-1');
    await reserveSlug('eventSlugs', 'taken', 'evt-2');

    await expect(
      renameSlug('eventSlugs', 'evt-1', { from: 'old-name', to: 'taken' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    // Neither half of the rename happened: the event still owns its old URL.
    expect((await eventSlugRef('old-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await eventSlugRef('taken').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('renaming to the current slug is a no-op', async () => {
    await reserveSlug('eventSlugs', 'same', 'evt-1');

    await expect(
      renameSlug('eventSlugs', 'evt-1', { from: 'same', to: 'same' }),
    ).resolves.toBe('same');
    expect((await eventSlugRef('same').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('still frees the old slug when the new one is already ours', async () => {
    // The state a partially-applied rename would leave behind; running it again
    // has to finish the job rather than 409 against ourselves.
    await reserveSlug('eventSlugs', 'old-name', 'evt-1');
    await reserveSlug('eventSlugs', 'new-name', 'evt-1');

    await expect(
      renameSlug('eventSlugs', 'evt-1', { from: 'old-name', to: 'new-name' }),
    ).resolves.toBe('new-name');
    expect((await eventSlugRef('old-name').get()).exists).toBe(false);
    expect((await eventSlugRef('new-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('takes the new slug even when the old reservation is missing', async () => {
    await expect(
      renameSlug('eventSlugs', 'evt-1', { from: 'never-existed', to: 'fresh' }),
    ).resolves.toBe('fresh');
    expect((await eventSlugRef('fresh').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('never releases an old slug held by somebody else', async () => {
    await reserveSlug('eventSlugs', 'not-mine', 'evt-2');

    await renameSlug('eventSlugs', 'evt-1', { from: 'not-mine', to: 'mine' });

    expect((await eventSlugRef('not-mine').get()).data()).toEqual({
      eventId: 'evt-2',
    });
    expect((await eventSlugRef('mine').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('validates both slugs before writing anything', async () => {
    await reserveSlug('eventSlugs', 'old-name', 'evt-1');

    await expect(
      renameSlug('eventSlugs', 'evt-1', { from: 'old-name', to: 'NOT VALID' }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
    expect((await eventSlugRef('old-name').get()).exists).toBe(true);
  });
});

describe('releaseSlug', () => {
  it('deletes a reservation its owner holds', async () => {
    await reserveSlug('orgSlugs', 'gone', 'org-1');

    await expect(releaseSlug('orgSlugs', 'gone', 'org-1')).resolves.toBe(true);
    expect((await orgSlugRef('gone').get()).exists).toBe(false);
  });

  it('reports false for a slug nobody holds', async () => {
    await expect(releaseSlug('orgSlugs', 'absent', 'org-1')).resolves.toBe(
      false,
    );
  });

  it('refuses to delete somebody else’s reservation', async () => {
    await reserveSlug('orgSlugs', 'theirs', 'org-2');

    await expect(releaseSlug('orgSlugs', 'theirs', 'org-1')).resolves.toBe(
      false,
    );
    expect((await orgSlugRef('theirs').get()).data()).toEqual({
      orgId: 'org-2',
    });
  });
});
