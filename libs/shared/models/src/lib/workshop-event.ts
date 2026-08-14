import type { Timestamp } from './timestamp';

/** Lifecycle of an event. */
export type EventStatus = 'draft' | 'published' | 'cancelled';

/**
 * Supported currencies. CAD only for now; the field exists so that adding
 * another currency later is additive rather than a migration.
 */
export type Currency = 'cad';

/**
 * Event document: `events/{eventId}`.
 *
 * Top-level collection with `orgId` as a field (not a subcollection of the
 * organizer), so the public browse query can read across all orgs.
 */
export interface WorkshopEvent {
  eventId: string;
  /** Owning organizer; events are top-level, so the org is a field. */
  orgId: string;
  title: string;
  /** Unique; enforced by an `eventSlugs/{slug}` reservation doc. */
  slug: string;
  description: string;
  startsAt: Timestamp;
  endsAt?: Timestamp;
  /**
   * IANA time zone name, e.g. `'America/Toronto'`. Needed to schedule reminders
   * and to render local times — never a UTC offset, which breaks across DST.
   */
  timezone: string;
  location?: string;
  /** Price in **minor units** (cents). `0` means free. */
  price: number;
  currency: Currency;
  /** Capacity. `0` means unlimited. */
  maxGuests: number;
  /** Guests holding a confirmed spot. Transactional counter. */
  confirmedCount: number;
  /** Paid reservations awaiting the Stripe webhook. Transactional counter. */
  heldCount: number;
  /** Waitlisted guests. Transactional counter. */
  pendingCount: number;
  status: EventStatus;
  /** Set once the reminder sweep has emailed this event's guests. */
  reminderSentAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
