import { describe, expect, it } from 'vitest';
import { fakeTimestamp } from '../../testing/fakes';
import {
  FIXTURE_START,
  fakeEvent,
  fakeOrg,
} from '../../testing/public-fixtures';
import { toPublicEvent, toPublicOrg } from './public-view';

/**
 * The projection is the app's disclosure boundary: everything an anonymous
 * browser ever learns about an event or an organizer goes through these two
 * functions. Most of what follows asserts on what is *absent*.
 */

describe('toPublicEvent', () => {
  it('publishes the descriptive fields', () => {
    const view = toPublicEvent(
      fakeEvent({
        title: 'Advanced Networking',
        description: 'Bring a laptop.',
        location: 'Room 3',
        price: 2500,
        endsAt: fakeTimestamp(new Date('2026-09-01T20:00:00.000Z')),
      }),
      'acme',
    );

    expect(view).toMatchObject({
      eventId: 'evt-1',
      orgId: 'org-1',
      title: 'Advanced Networking',
      slug: 'intro-to-networking',
      description: 'Bring a laptop.',
      location: 'Room 3',
      timezone: 'America/Toronto',
      price: 2500,
      currency: 'cad',
    });
  });

  it('never leaks the internal counters or the workflow timestamps', () => {
    const view = toPublicEvent(
      fakeEvent({
        confirmedCount: 4,
        heldCount: 2,
        pendingCount: 7,
        reminderSentAt: fakeTimestamp(FIXTURE_START),
      }),
      'acme',
    );

    // Written as an exact key set rather than a handful of `not.toHaveProperty`
    // assertions: a field added to `WorkshopEvent` later must fail this test
    // until someone decides whether it is public.
    expect(Object.keys(view).sort()).toEqual([
      'currency',
      'description',
      'eventId',
      'maxGuests',
      'orgId',
      'orgSlug',
      'price',
      'slug',
      'soldOut',
      'spotsRemaining',
      'startsAt',
      'timezone',
      'title',
    ]);
  });

  it('serializes timestamps as ISO-8601 strings', () => {
    const view = toPublicEvent(
      fakeEvent({
        endsAt: fakeTimestamp(new Date('2026-09-01T20:30:00.000Z')),
      }),
      'acme',
    );

    expect(view.startsAt).toBe('2026-09-01T18:00:00.000Z');
    expect(view.endsAt).toBe('2026-09-01T20:30:00.000Z');
  });

  it('omits the optional fields rather than sending null', () => {
    const view = toPublicEvent(fakeEvent(), 'acme');

    expect('endsAt' in view).toBe(false);
    expect('location' in view).toBe(false);
    expect('externalUrl' in view).toBe(false);
    expect('sourceName' in view).toBe(false);
    expect('imageUrl' in view).toBe(false);
  });

  it('publishes the fields a seeded community event needs to be clickable', () => {
    // Deliberately public, unlike the counters above: the page cannot send a
    // visitor to the source without the URL, and it must name whose listing it
    // is before the click rather than after.
    const view = toPublicEvent(
      fakeEvent({
        externalUrl: 'https://example.com/events/toronto-ai',
        sourceName: 'Meetup',
        imageUrl: 'https://example.com/poster.jpg',
      }),
      'acme',
    );

    expect(view).toMatchObject({
      externalUrl: 'https://example.com/events/toronto-ai',
      sourceName: 'Meetup',
      imageUrl: 'https://example.com/poster.jpg',
    });
  });

  describe('availability', () => {
    it('counts held spots against the remainder, not just confirmed ones', () => {
      const view = toPublicEvent(
        fakeEvent({ maxGuests: 10, confirmedCount: 6, heldCount: 3 }),
        'acme',
      );

      // 1, not 4: the three mid-checkout spots are not available to offer.
      expect(view.spotsRemaining).toBe(1);
      expect(view.soldOut).toBe(false);
    });

    it('is sold out at exactly zero remaining', () => {
      const view = toPublicEvent(
        fakeEvent({ maxGuests: 5, confirmedCount: 5, heldCount: 0 }),
        'acme',
      );

      expect(view.spotsRemaining).toBe(0);
      expect(view.soldOut).toBe(true);
    });

    it('clamps an over-subscribed event at zero instead of going negative', () => {
      const view = toPublicEvent(
        fakeEvent({ maxGuests: 2, confirmedCount: 5, heldCount: 0 }),
        'acme',
      );

      expect(view.spotsRemaining).toBe(0);
      expect(view.soldOut).toBe(true);
    });

    it('reports unlimited capacity as null and never sold out', () => {
      const view = toPublicEvent(
        fakeEvent({ maxGuests: 0, confirmedCount: 900 }),
        'acme',
      );

      expect(view.spotsRemaining).toBeNull();
      expect(view.soldOut).toBe(false);
    });

    it('ignores the waitlist depth', () => {
      const open = toPublicEvent(
        fakeEvent({ maxGuests: 10, pendingCount: 0 }),
        'acme',
      );
      const queued = toPublicEvent(
        fakeEvent({ maxGuests: 10, pendingCount: 50 }),
        'acme',
      );

      expect(queued.spotsRemaining).toBe(open.spotsRemaining);
    });
  });
});

describe('toPublicOrg', () => {
  it('publishes only the public profile', () => {
    const view = toPublicOrg(fakeOrg());

    expect(view).toEqual({
      orgId: 'org-1',
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
    });
  });

  it('never leaks the staff roster', () => {
    // `members` and `memberUids` name every person with write access to the
    // org, by Firebase uid. This is the assertion that must never be relaxed.
    const view = toPublicOrg(
      fakeOrg({
        memberUids: ['uid-1', 'uid-secret'],
        createdBy: 'uid-secret',
      }),
    );

    expect(JSON.stringify(view)).not.toContain('uid-secret');
    expect('members' in view).toBe(false);
    expect('memberUids' in view).toBe(false);
    expect('createdBy' in view).toBe(false);
  });
});
