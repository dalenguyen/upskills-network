import type { Currency, EventStatus, WorkshopEvent } from '@upskills/models';

/**
 * The projection the dashboard routes answer with.
 *
 * `WorkshopEvent` stores `Timestamp` values, which do not survive JSON intact.
 * The dashboard still needs the fields the public pages hide — the three
 * counters, the lifecycle timestamps — because an organizer is entitled to
 * their own operational detail. What changes is only the representation:
 * Firestore `Timestamp` becomes ISO-8601, the same convention the public
 * projection uses.
 */

/** An event as the organizer dashboard sees it. */
export interface DashboardEvent {
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
  /** Capacity. `0` means unlimited. */
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
