import { describe, expect, it } from 'vitest';
import type {
  Guest,
  Organizer,
  Timestamp,
  User,
  WaitlistSubscriber,
  WorkshopEvent,
} from '../index';

/**
 * The lib exports types only, so these tests are compile-time checks that also
 * run: every fixture below fails `tsc` if an interface drifts, and the runtime
 * assertions pin the invariants the rest of the system relies on.
 */

/** Minimal stand-in with the same shape Firestore's `Timestamp` exposes. */
function ts(iso: string): Timestamp {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

const NOW = ts('2026-09-01T18:00:00.000Z');

describe('Timestamp', () => {
  it('is satisfied by a Firestore-style Timestamp class instance', () => {
    // Mirrors firebase-admin's Timestamp: extra members are fine structurally.
    class FirestoreLikeTimestamp {
      constructor(
        readonly seconds: number,
        readonly nanoseconds: number,
      ) {}
      toDate(): Date {
        return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
      }
      toMillis(): number {
        return this.seconds * 1000 + Math.round(this.nanoseconds / 1e6);
      }
    }

    const value: Timestamp = new FirestoreLikeTimestamp(1_772_042_400, 0);

    expect(value.toMillis()).toBe(1_772_042_400_000);
    expect(value.toDate()).toBeInstanceOf(Date);
  });
});

describe('User', () => {
  it('carries a platform role and denormalized org ids', () => {
    const user: User = {
      uid: 'uid-1',
      email: 'organizer@example.com',
      name: 'Ada',
      role: 'user',
      orgIds: ['org-1'],
      createdAt: NOW,
    };

    expect(user.role).toBe('user');
    expect(user.orgIds).toContain('org-1');
  });

  it('allows a user with no orgs', () => {
    const user: User = {
      uid: 'uid-2',
      email: 'nobody@example.com',
      role: 'admin',
      orgIds: [],
      createdAt: NOW,
    };

    expect(user.orgIds).toHaveLength(0);
    expect(user.name).toBeUndefined();
  });
});

describe('Organizer', () => {
  const organizer: Organizer = {
    orgId: 'org-1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-1',
    members: {
      'uid-1': { role: 'admin', addedAt: NOW },
      'uid-2': { role: 'check_in', addedAt: NOW },
    },
    memberUids: ['uid-1', 'uid-2'],
    createdAt: NOW,
  };

  it('keys members by uid so security rules can index them', () => {
    // `members[uid]` is exactly what the rules evaluate — only valid on a map.
    expect(organizer.members['uid-2']?.role).toBe('check_in');
  });

  it('mirrors the member keys into memberUids for array-contains queries', () => {
    expect(organizer.memberUids).toEqual(Object.keys(organizer.members));
  });
});

describe('WorkshopEvent', () => {
  const event: WorkshopEvent = {
    eventId: 'evt-1',
    orgId: 'org-1',
    createdBy: 'uid-1',
    title: 'Intro to Networking',
    slug: 'intro-to-networking',
    description: 'A hands-on session.',
    startsAt: NOW,
    endsAt: ts('2026-09-01T20:00:00.000Z'),
    timezone: 'America/Toronto',
    location: 'Toronto Reference Library',
    price: 2500,
    currency: 'cad',
    maxGuests: 30,
    confirmedCount: 0,
    heldCount: 0,
    pendingCount: 0,
    status: 'published',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('stores orgId as a field because events are a top-level collection', () => {
    expect(event.orgId).toBe('org-1');
  });

  it('records the uid of the creator', () => {
    expect(event.createdBy).toBe('uid-1');
  });

  it('stores price in minor units and only supports cad', () => {
    expect(event.price).toBe(2500); // $25.00 CAD
    expect(event.currency).toBe('cad');
  });

  it('treats maxGuests 0 as unlimited', () => {
    const unlimited: WorkshopEvent = { ...event, maxGuests: 0 };

    expect(unlimited.maxGuests).toBe(0);
  });

  it('leaves optional scheduling fields off a draft', () => {
    const draft: WorkshopEvent = {
      ...event,
      status: 'draft',
      endsAt: undefined,
      location: undefined,
    };

    expect(draft.endsAt).toBeUndefined();
    expect(draft.reminderSentAt).toBeUndefined();
  });

  it('exposes the three capacity counters', () => {
    const busy: WorkshopEvent = {
      ...event,
      confirmedCount: 28,
      heldCount: 2,
      pendingCount: 5,
    };

    expect(busy.confirmedCount + busy.heldCount).toBe(busy.maxGuests);
    expect(busy.pendingCount).toBe(5);
  });
});

describe('Guest', () => {
  it('uses the normalized email as its doc id', () => {
    const guest: Guest = {
      guestId: 'guest@example.com',
      eventId: 'evt-1',
      orgId: 'org-1',
      email: 'guest@example.com',
      name: 'Grace',
      status: 'confirmed',
      registeredAt: NOW,
      confirmedAt: NOW,
      cancelToken: 'tok_abc123',
    };

    expect(guest.guestId).toBe(guest.email.trim().toLowerCase());
  });

  it('models a held reservation awaiting the Stripe webhook', () => {
    const held: Guest = {
      guestId: 'paid@example.com',
      eventId: 'evt-1',
      orgId: 'org-1',
      email: 'paid@example.com',
      name: 'Alan',
      status: 'held',
      registeredAt: NOW,
      cancelToken: 'tok_def456',
      stripeSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_test_1',
      amountPaid: 2500,
      holdExpiresAt: ts('2026-09-01T18:30:00.000Z'),
    };

    expect(held.status).toBe('held');
    expect(held.holdExpiresAt?.toMillis()).toBeGreaterThan(NOW.toMillis());
  });

  it('models a waitlisted guest with a position', () => {
    const pending: Guest = {
      guestId: 'wait@example.com',
      eventId: 'evt-1',
      orgId: 'org-1',
      email: 'wait@example.com',
      name: 'Katherine',
      status: 'pending',
      registeredAt: NOW,
      waitlistPosition: 1,
      cancelToken: 'tok_ghi789',
    };

    expect(pending.waitlistPosition).toBe(1);
  });

  it('records who checked a guest in', () => {
    const checkedIn: Guest = {
      guestId: 'here@example.com',
      eventId: 'evt-1',
      orgId: 'org-1',
      email: 'here@example.com',
      name: 'Edsger',
      status: 'confirmed',
      registeredAt: NOW,
      confirmedAt: NOW,
      checkedInAt: NOW,
      checkedInBy: 'uid-2',
      cancelToken: 'tok_jkl012',
    };

    expect(checkedIn.checkedInBy).toBe('uid-2');
  });
});

describe('WaitlistSubscriber', () => {
  it('is an email plus the moment it signed up', () => {
    const subscriber: WaitlistSubscriber = {
      email: 'interested@example.com',
      createdAt: NOW,
    };

    expect(subscriber.email).toBe('interested@example.com');
    expect(subscriber.createdAt.toMillis()).toBe(NOW.toMillis());
  });
});
