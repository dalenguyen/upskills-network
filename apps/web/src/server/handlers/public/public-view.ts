import type { Currency, Organizer, WorkshopEvent } from '@upskills/models';

/**
 * The projections every unauthenticated route answers with.
 *
 * ## Why the stored documents are never returned whole
 *
 * `WorkshopEvent` and `Organizer` are internal records, and both carry fields
 * that would be a leak on a public page:
 *
 * - `heldCount` is the number of people mid-checkout. Publishing it broadcasts
 *   how many strangers are on a payment screen right now, which is operational
 *   detail nobody outside the org is owed.
 * - `pendingCount` is the waitlist depth. A visitor needs to know *whether*
 *   they would be waitlisted, not how many people are ahead of the queue.
 * - `reminderSentAt`, `createdAt`, `updatedAt` describe the org's internal
 *   workflow.
 * - `Organizer.members` and `memberUids` are the org's staff roster keyed by
 *   Firebase uid. That is the single worst field to ship to an anonymous
 *   browser: it names every person with write access, by stable id.
 *
 * Projecting explicitly — rather than deleting keys from a spread — means a
 * field added to a model later is invisible here until someone chooses to
 * publish it. The default for new data is private.
 *
 * ## Why availability is derived and the counters are not published
 *
 * The only capacity question a public page asks is "can I still get a spot".
 * Answering it with {@link PublicEvent.spotsRemaining} gives the UI exactly
 * that, computed from the confirmed *and* held counts so a spot mid-checkout is
 * not offered twice — while keeping the two raw counters unpublished. The value
 * is advisory: it is a snapshot from a non-transactional read, and the
 * authoritative capacity check is the one `reserveSpot` makes inside its
 * transaction. A page that shows "1 spot left" can still legitimately produce a
 * waitlisted registration.
 */

/** An event as an anonymous visitor sees it. */
export interface PublicEvent {
  eventId: string;
  orgId: string;
  title: string;
  slug: string;
  description: string;
  /** ISO-8601 — a Firestore `Timestamp` does not survive JSON intact. */
  startsAt: string;
  endsAt?: string;
  /** IANA zone name, so the client can render the organizer's local time. */
  timezone: string;
  location?: string;
  /** Minor units (cents). `0` is free. */
  price: number;
  currency: Currency;
  /** `0` means unlimited. */
  maxGuests: number;
  /**
   * Spots still open, or `null` when capacity is unlimited. Never negative.
   * Advisory only — see the module comment.
   */
  spotsRemaining: number | null;
  /** `true` when a registration would be waitlisted rather than confirmed. */
  soldOut: boolean;
}

/** An organizer as an anonymous visitor sees it. */
export interface PublicOrg {
  orgId: string;
  name: string;
  slug: string;
}

/** Spots left, or `null` for unlimited capacity. */
function spotsRemaining(event: WorkshopEvent): number | null {
  if (event.maxGuests === 0) {
    return null;
  }

  // Clamped at zero: an over-subscription (a counter drifting, or capacity
  // lowered under a full event) is an operational problem, not something to
  // render as "-3 spots left".
  return Math.max(0, event.maxGuests - event.confirmedCount - event.heldCount);
}

export function toPublicEvent(event: WorkshopEvent): PublicEvent {
  const remaining = spotsRemaining(event);

  return {
    eventId: event.eventId,
    orgId: event.orgId,
    title: event.title,
    slug: event.slug,
    description: event.description,
    startsAt: event.startsAt.toDate().toISOString(),
    ...(event.endsAt === undefined
      ? {}
      : { endsAt: event.endsAt.toDate().toISOString() }),
    timezone: event.timezone,
    ...(event.location === undefined ? {} : { location: event.location }),
    price: event.price,
    currency: event.currency,
    maxGuests: event.maxGuests,
    spotsRemaining: remaining,
    soldOut: remaining === 0,
  };
}

export function toPublicOrg(org: Organizer): PublicOrg {
  return { orgId: org.orgId, name: org.name, slug: org.slug };
}
