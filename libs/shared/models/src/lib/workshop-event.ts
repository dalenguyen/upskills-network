import type { Timestamp } from './timestamp';

/** Lifecycle of an event. */
export type EventStatus = 'draft' | 'published' | 'cancelled';

/**
 * Supported currencies. CAD only for now; the field exists so that adding
 * another currency later is additive rather than a migration.
 */
export type Currency = 'cad';

/**
 * Event document: `organizers/{orgId}/events/{eventId}`.
 *
 * A subcollection of the organizer, so ownership is the document's *path* rather
 * than a field a writer has to remember to set — an event cannot be saved into
 * the wrong org without addressing a different collection, and "every event this
 * org owns" needs no filter at all.
 *
 * The public browse still reads across all orgs, as a **collection-group** query
 * on `events` backed by a COLLECTION_GROUP index. That is the cost of the
 * subcollection, and it is a small one: the index is declared in
 * `firestore.indexes.json` exactly like the top-level one it replaced.
 */
export interface WorkshopEvent {
  eventId: string;
  /**
   * Owning organizer — the same value as the `{orgId}` path segment.
   *
   * Duplicated into the body because a collection-group query returns documents
   * whose path the caller never named, and every consumer of a browse result
   * needs the org to build a `/{orgSlug}/{eventSlug}` link. `reads.ts` stamps it
   * back from the path on the way out, so the path stays authoritative.
   */
  orgId: string;
  /** uid of the creator. */
  createdBy: string;
  title: string;
  /**
   * Unique **within the organizer**; enforced by an
   * `organizers/{orgId}/eventSlugs/{slug}` reservation doc. Two organizers may
   * each hold `react-basics`, because the public URL that resolves it is
   * `/{orgSlug}/{eventSlug}`.
   */
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
