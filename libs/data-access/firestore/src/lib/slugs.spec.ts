import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent, seedOrg } from '../testing/seed';
import { eventSlugRef, orgSlugRef } from './collections';
import { getEventByPath, getOrgBySlug } from './reads';
import {
  InvalidSlugError,
  ORG_SLUGS,
  SlugTakenError,
  eventSlugsOf,
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
    await reserveSlug(eventSlugsOf('org-1'), 'react-basics', 'evt-1');
    await reserveSlug(ORG_SLUGS, 'upskills-yyz', 'org-1');

    expect((await eventSlugRef('org-1', 'react-basics').get()).data()).toEqual({
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
    await reserveSlug(ORG_SLUGS, 'org-alias', 'org-x');
    await reserveSlug(eventSlugsOf('org-x'), 'event-alias', 'evt-x');

    expect((await getOrgBySlug('org-alias'))?.orgId).toBe('org-x');
    expect(
      (await getEventByPath('seeded-org', 'event-alias'))?.event.eventId,
    ).toBe('evt-x');
  });

  it('returns the slug it stored, trimmed', async () => {
    expect(
      await reserveSlug(eventSlugsOf('org-1'), '  react-basics  ', 'evt-1'),
    ).toBe('react-basics');
    expect((await eventSlugRef('org-1', 'react-basics').get()).exists).toBe(
      true,
    );
  });

  it('rejects a second owner with a typed error, not a gRPC failure', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'react-basics', 'evt-1');

    const failure = await reserveSlug(
      eventSlugsOf('org-1'),
      'react-basics',
      'evt-2',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SlugTakenError);
    expect(failure).toMatchObject({
      target: { kind: 'event', orgId: 'org-1' },
      slug: 'react-basics',
      heldBy: 'evt-1',
    });
    // The loser changed nothing.
    expect((await eventSlugRef('org-1', 'react-basics').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('is idempotent for the owner that already holds it', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'react-basics', 'evt-1');

    await expect(
      reserveSlug(eventSlugsOf('org-1'), 'react-basics', 'evt-1'),
    ).resolves.toBe('react-basics');
    expect((await eventSlugRef('org-1', 'react-basics').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('keeps the two collections independent', async () => {
    await reserveSlug(ORG_SLUGS, 'shared-name', 'org-1');

    // Same slug, different namespace: /org/shared-name and /events/shared-name
    // are different URLs and must not collide.
    await expect(
      reserveSlug(eventSlugsOf('org-1'), 'shared-name', 'evt-1'),
    ).resolves.toBe('shared-name');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['uppercase', 'React-Basics'],
    ['a path separator', 'react/basics'],
    ['spaces inside', 'react basics'],
  ])('rejects %s with InvalidSlugError', async (_label, slug) => {
    await expect(
      reserveSlug(eventSlugsOf('org-1'), slug, 'evt-1'),
    ).rejects.toThrow(InvalidSlugError);
  });
});

describe('renameSlug', () => {
  it('frees the old slug and takes the new one', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-1');

    expect(
      await renameSlug(eventSlugsOf('org-1'), 'evt-1', {
        from: 'old-name',
        to: 'new-name',
      }),
    ).toBe('new-name');

    expect((await eventSlugRef('org-1', 'old-name').get()).exists).toBe(false);
    expect((await eventSlugRef('org-1', 'new-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('leaves the freed slug available to somebody else', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-1');
    await renameSlug(eventSlugsOf('org-1'), 'evt-1', {
      from: 'old-name',
      to: 'new-name',
    });

    await expect(
      reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-2'),
    ).resolves.toBe('old-name');
    expect((await eventSlugRef('org-1', 'old-name').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('refuses a slug another owner holds and keeps the old one intact', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-1');
    await reserveSlug(eventSlugsOf('org-1'), 'taken', 'evt-2');

    await expect(
      renameSlug(eventSlugsOf('org-1'), 'evt-1', {
        from: 'old-name',
        to: 'taken',
      }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    // Neither half of the rename happened: the event still owns its old URL.
    expect((await eventSlugRef('org-1', 'old-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await eventSlugRef('org-1', 'taken').get()).data()).toEqual({
      eventId: 'evt-2',
    });
  });

  it('renaming to the current slug is a no-op', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'same', 'evt-1');

    await expect(
      renameSlug(eventSlugsOf('org-1'), 'evt-1', { from: 'same', to: 'same' }),
    ).resolves.toBe('same');
    expect((await eventSlugRef('org-1', 'same').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('still frees the old slug when the new one is already ours', async () => {
    // The state a partially-applied rename would leave behind; running it again
    // has to finish the job rather than 409 against ourselves.
    await reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-1');
    await reserveSlug(eventSlugsOf('org-1'), 'new-name', 'evt-1');

    await expect(
      renameSlug(eventSlugsOf('org-1'), 'evt-1', {
        from: 'old-name',
        to: 'new-name',
      }),
    ).resolves.toBe('new-name');
    expect((await eventSlugRef('org-1', 'old-name').get()).exists).toBe(false);
    expect((await eventSlugRef('org-1', 'new-name').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('takes the new slug even when the old reservation is missing', async () => {
    await expect(
      renameSlug(eventSlugsOf('org-1'), 'evt-1', {
        from: 'never-existed',
        to: 'fresh',
      }),
    ).resolves.toBe('fresh');
    expect((await eventSlugRef('org-1', 'fresh').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('never releases an old slug held by somebody else', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'not-mine', 'evt-2');

    await renameSlug(eventSlugsOf('org-1'), 'evt-1', {
      from: 'not-mine',
      to: 'mine',
    });

    expect((await eventSlugRef('org-1', 'not-mine').get()).data()).toEqual({
      eventId: 'evt-2',
    });
    expect((await eventSlugRef('org-1', 'mine').get()).data()).toEqual({
      eventId: 'evt-1',
    });
  });

  it('validates both slugs before writing anything', async () => {
    await reserveSlug(eventSlugsOf('org-1'), 'old-name', 'evt-1');

    await expect(
      renameSlug(eventSlugsOf('org-1'), 'evt-1', {
        from: 'old-name',
        to: 'NOT VALID',
      }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
    expect((await eventSlugRef('org-1', 'old-name').get()).exists).toBe(true);
  });
});

describe('releaseSlug', () => {
  it('deletes a reservation its owner holds', async () => {
    await reserveSlug(ORG_SLUGS, 'gone', 'org-1');

    await expect(releaseSlug(ORG_SLUGS, 'gone', 'org-1')).resolves.toBe(true);
    expect((await orgSlugRef('gone').get()).exists).toBe(false);
  });

  it('reports false for a slug nobody holds', async () => {
    await expect(releaseSlug(ORG_SLUGS, 'absent', 'org-1')).resolves.toBe(
      false,
    );
  });

  it('refuses to delete somebody else’s reservation', async () => {
    await reserveSlug(ORG_SLUGS, 'theirs', 'org-2');

    await expect(releaseSlug(ORG_SLUGS, 'theirs', 'org-1')).resolves.toBe(
      false,
    );
    expect((await orgSlugRef('theirs').get()).data()).toEqual({
      orgId: 'org-2',
    });
  });
});

describe('releaseSlug and the reserved-word policy', () => {
  // `RESERVED_SLUGS` can grow. When it does, organizers already holding a
  // now-reserved slug must still be deletable — applying the policy on the way
  // out would strand them behind a rule introduced after they were created.
  it('gives back a slug the reservation policy would now refuse', async () => {
    // Written directly: `reserveSlug` is exactly what would refuse this today.
    await orgSlugRef('dashboard').set({ orgId: 'org-legacy' });

    await expect(
      releaseSlug(ORG_SLUGS, 'dashboard', 'org-legacy'),
    ).resolves.toBe(true);
    await expect(orgSlugRef('dashboard').get()).resolves.toMatchObject({
      exists: false,
    });
  });

  it('still refuses a slug that is not a legal document id', async () => {
    await expect(releaseSlug(ORG_SLUGS, 'Not A Slug', 'org-1')).rejects.toThrow(
      InvalidSlugError,
    );
  });
});
