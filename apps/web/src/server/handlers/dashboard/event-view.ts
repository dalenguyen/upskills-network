import type { Currency, EventStatus, WorkshopEvent } from '@upskills/models';

/**
 * The projection the authenticated dashboard answers with.
 *
 * Unlike the public view, this is the organizer's own record and may carry the
 * operational fields the public page must not: the live counters, lifecycle
 * status, and the timestamps that describe their workflow. It still converts
 * every Firestore `Timestamp` to ISO-8601, because a `Timestamp` does not
 * survive JSON intact.
 */

export interface DashboardEvent {
  eventId: string;
  orgId: string;
  title: string;
  slug: string;
  description: string;
  /** ISO-8601. */
  startsAt: string;
  endsAt?: string;
  timezone: string;
  location?: string;
  /** Minor units (cents). `0` is free. */
  price: number;
  currency: Currency;
  maxGuests: number;
  confirmedCount: number;
  heldCount: number;
  pendingCount: number;
  status: EventStatus;
  reminderSentAt?: string;
  createdAt: string;
  updatedAt: string;
}

function iso(timestamp: WorkshopEvent['startsAt']): string {
  return timestamp.toDate().toISOString();
}

export function toDashboardEvent(event: WorkshopEvent): DashboardEvent {
  return {
    eventId: event.eventId,
    orgId: event.orgId,
    title: event.title,
    slug: event.slug,
    description: event.description,
    startsAt: iso(event.startsAt),
    ...(event.endsAt === undefined ? {} : { endsAt: iso(event.endsAt) }),
    timezone: event.timezone,
    ...(event.location === undefined ? {} : { location: event.location }),
    price: event.price,
    currency: event.currency,
    maxGuests: event.maxGuests,
    confirmedCount: event.confirmedCount,
    heldCount: event.heldCount,
    pendingCount: event.pendingCount,
    status: event.status,
    ...(event.reminderSentAt === undefined
      ? {}
      : { reminderSentAt: iso(event.reminderSentAt) }),
    createdAt: iso(event.createdAt),
    updatedAt: iso(event.updatedAt),
  };
}
