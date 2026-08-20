import { describe, expect, it, vi } from 'vitest';
import {
  seedCommunityEvents,
  type CommunityEventDraft,
  type SeedCommunityEventsDeps,
} from './seed-community-events';

/**
 * The curated community-events seed, against injected deps.
 *
 * The Firestore reads and writes are a thin executable under
 * `apps/web/scripts/`; the policy worth proving here is what makes the script
 * safe to run twice against production — slug-keyed identity, the values a
 * listed event is forced to carry, and the fact that a malformed row costs you
 * that row and nothing else.
 */

/** A complete, valid row. Tests override only what they assert on. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Toronto AI Meetup',
    slug: 'toronto-ai-meetup',
    description: 'Monthly talks.',
    startsAt: '2026-09-04T18:30:00-04:00',
    timezone: 'America/Toronto',
    externalUrl: 'https://example.com/events/toronto-ai',
    sourceName: 'Meetup',
    ...overrides,
  };
}

function deps(
  overrides: Partial<SeedCommunityEventsDeps> = {},
): SeedCommunityEventsDeps {
  return {
    findEventIdBySlug: vi.fn(async () => null),
    createEvent: vi.fn(async () => undefined),
    updateEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

const options = { createdBy: 'uid-admin' };

describe('seedCommunityEvents', () => {
  it('creates an event whose slug is not yet taken', async () => {
    const d = deps();

    const result = await seedCommunityEvents([row()], d, options);

    expect(result.created).toEqual(['toronto-ai-meetup']);
    expect(result.updated).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(d.updateEvent).not.toHaveBeenCalled();
  });

  it('updates in place when the slug already resolves, so a re-run is idempotent', async () => {
    const d = deps({ findEventIdBySlug: async () => 'evt-existing' });

    const result = await seedCommunityEvents([row()], d, options);

    expect(result.created).toEqual([]);
    expect(result.updated).toEqual(['toronto-ai-meetup']);
    expect(d.createEvent).not.toHaveBeenCalled();
    expect(d.updateEvent).toHaveBeenCalledWith(
      'evt-existing',
      expect.objectContaining({ slug: 'toronto-ai-meetup' }),
    );
  });

  it('forces every listed event to published, free, uncapped and attributed', async () => {
    const d = deps();

    await seedCommunityEvents(
      // Values the file has no business setting are not read even if present.
      [row({ status: 'draft', price: 5000, maxGuests: 20 })],
      d,
      options,
    );

    expect(d.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        price: 0,
        currency: 'cad',
        maxGuests: 0,
        createdBy: 'uid-admin',
        externalUrl: 'https://example.com/events/toronto-ai',
      } satisfies Partial<CommunityEventDraft>),
    );
  });

  it('passes startTimeTbd through, so a dateless-time row renders as TBA', async () => {
    const d = deps();

    await seedCommunityEvents([row({ startTimeTbd: true })], d, options);

    expect(d.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ startTimeTbd: true }),
    );
  });

  it('rejects one bad row and still writes the good ones around it', async () => {
    const d = deps();

    const result = await seedCommunityEvents(
      [
        row({ slug: 'first' }),
        row({ slug: 'second', timezone: 'Mars/Olympus' }),
        row({ slug: 'third' }),
      ],
      d,
      options,
    );

    expect(result.created).toEqual(['first', 'third']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ index: 1, slug: 'second' });
  });

  it('refuses a non-https externalUrl', async () => {
    const d = deps();

    const result = await seedCommunityEvents(
      [row({ externalUrl: 'http://example.com/events/toronto-ai' })],
      d,
      options,
    );

    expect(result.created).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('refuses a second row claiming a slug an earlier row already used', async () => {
    const d = deps();

    const result = await seedCommunityEvents(
      [row({ title: 'First' }), row({ title: 'Second' })],
      d,
      options,
    );

    // Without this the file would list two events, the database would hold one,
    // and nothing would say so.
    expect(result.created).toEqual(['toronto-ai-meetup']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].problems[0]).toMatch(/duplicate slug/i);
    expect(d.createEvent).toHaveBeenCalledTimes(1);
  });

  it('refuses an endsAt that precedes startsAt', async () => {
    const d = deps();

    const result = await seedCommunityEvents(
      [row({ endsAt: '2026-09-04T17:00:00-04:00' })],
      d,
      options,
    );

    expect(result.rejected).toHaveLength(1);
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('reports a file that is not an array rather than throwing', async () => {
    const d = deps();

    const result = await seedCommunityEvents({ events: [] }, d, options);

    expect(result.rejected).toHaveLength(1);
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('writes nothing at all for an empty file', async () => {
    const d = deps();

    const result = await seedCommunityEvents([], d, options);

    expect(result).toEqual({ created: [], updated: [], rejected: [] });
    expect(d.findEventIdBySlug).not.toHaveBeenCalled();
  });
});
