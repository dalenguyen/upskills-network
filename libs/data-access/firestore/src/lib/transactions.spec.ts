import type { WorkshopEvent } from '@upskills/models';
import { describe, expect, it } from 'vitest';
import { T0 } from '../testing/seed';
import {
  ACTIVE_STATUSES,
  clearFields,
  counterPatch,
  isActive,
  nextCount,
  newCancelToken,
} from './transactions';

/**
 * The counter arithmetic on its own — no emulator. These are the branches the
 * transaction tests cannot reach on purpose: a counter that has already drifted
 * out of step with its guests, which is what the clamp exists for.
 */

const event = (counters: Partial<WorkshopEvent> = {}): WorkshopEvent => ({
  eventId: 'evt-1',
  orgId: 'org-1',
  title: 'T',
  slug: 't',
  description: 'd',
  startsAt: T0,
  timezone: 'America/Toronto',
  price: 0,
  currency: 'cad',
  maxGuests: 10,
  confirmedCount: 0,
  heldCount: 0,
  pendingCount: 0,
  status: 'published',
  createdAt: T0,
  updatedAt: T0,
  ...counters,
});

describe('nextCount', () => {
  it('adds the delta', () => {
    expect(nextCount(3, 1)).toBe(4);
    expect(nextCount(3, -1)).toBe(2);
  });

  it('floors at zero so drifted data cannot turn into free seats', () => {
    expect(nextCount(0, -1)).toBe(0);
  });
});

describe('counterPatch', () => {
  it('moves a guest from one counter to another in a single patch', () => {
    expect(
      counterPatch(
        event({ heldCount: 2, confirmedCount: 5 }),
        'held',
        'confirmed',
      ),
    ).toEqual({ heldCount: 1, confirmedCount: 6 });
  });

  it('only increments for a brand-new registration', () => {
    expect(counterPatch(event({ pendingCount: 4 }), null, 'pending')).toEqual({
      pendingCount: 5,
    });
  });

  it('only decrements when the guest lands in an uncounted status', () => {
    expect(
      counterPatch(event({ confirmedCount: 2 }), 'confirmed', 'cancelled'),
    ).toEqual({ confirmedCount: 1 });
    expect(counterPatch(event({ heldCount: 2 }), 'held', 'expired')).toEqual({
      heldCount: 1,
    });
  });

  it('writes nothing when neither side is counted', () => {
    expect(counterPatch(event(), 'expired', 'cancelled')).toEqual({});
    expect(counterPatch(event(), null, null)).toEqual({});
  });

  it('writes nothing when the status does not actually move', () => {
    expect(
      counterPatch(event({ confirmedCount: 3 }), 'confirmed', 'confirmed'),
    ).toEqual({});
  });
});

describe('isActive', () => {
  it('is true exactly for the statuses that occupy a place', () => {
    expect(ACTIVE_STATUSES).toEqual(['confirmed', 'held', 'pending']);
    expect(isActive('confirmed')).toBe(true);
    expect(isActive('held')).toBe(true);
    expect(isActive('pending')).toBe(true);
    // These two already gave their place back, so registering again is new.
    expect(isActive('cancelled')).toBe(false);
    expect(isActive('expired')).toBe(false);
  });
});

describe('clearFields', () => {
  it('removes the key rather than setting it undefined', () => {
    const cleared = clearFields(
      {
        guestId: 'a@e.com',
        eventId: 'evt-1',
        orgId: 'org-1',
        email: 'a@e.com',
        name: 'A',
        status: 'pending',
        registeredAt: T0,
        cancelToken: 'tok',
        waitlistPosition: 3,
        holdExpiresAt: T0,
      },
      'waitlistPosition',
      'holdExpiresAt',
    );

    expect('waitlistPosition' in cleared).toBe(false);
    expect('holdExpiresAt' in cleared).toBe(false);
    expect(cleared.email).toBe('a@e.com');
  });
});

describe('newCancelToken', () => {
  it('is url-safe and unguessable', () => {
    const tokens = Array.from({ length: 100 }, newCancelToken);

    expect(new Set(tokens).size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });
});
