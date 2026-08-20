import type { AuthContext, OrgContext } from '@upskills/auth';
import type {
  Guest,
  GuestStatus,
  OrgRole,
  WorkshopEvent,
} from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden, readOrgId } from './dashboard-access';

/**
 * `GET /api/v1/dashboard/events/:eventId/guests?orgId=` — the guest list for
 * one event owned by one org.
 *
 * Auth ordering matches `events-detail.ts`: `requireAuth` runs before the
 * event is read, so a missing event and one the caller cannot see answer the
 * identical 403 from {@link eventForbidden}, and an unauthenticated caller
 * always gets 401 first regardless of whether the event id is real.
 *
 * ## No email on the wire
 *
 * `Guest.email` (and `guestId`, which *is* the normalized email) never leave
 * this handler. The dashboard's guest list exists so an organizer can see who
 * is coming and check them in at the door — a name and a status answer that.
 * Emailing a guest is done by the organizer through their own inbox, not by
 * this page, so there is no feature here that spending an email address buys.
 */

/** One guest, as the dashboard's guest list shows it — no email, no doc id. */
export interface GuestView {
  name: string;
  status: GuestStatus;
  /** ISO-8601 — a Firestore `Timestamp` does not survive JSON intact. */
  registeredAt: string;
  checkedInAt?: string;
  /** 1-based position while `status` is `'pending'`. */
  waitlistPosition?: number;
}

export interface DashboardEventsGuestsResponse {
  guests: GuestView[];
}

function toGuestView(guest: Guest): GuestView {
  return {
    name: guest.name,
    status: guest.status,
    registeredAt: guest.registeredAt.toDate().toISOString(),
    ...(guest.checkedInAt === undefined
      ? {}
      : { checkedInAt: guest.checkedInAt.toDate().toISOString() }),
    ...(guest.waitlistPosition === undefined
      ? {}
      : { waitlistPosition: guest.waitlistPosition }),
  };
}

export interface DashboardEventsGuestsDeps {
  /** `requireAuth` from `@upskills/auth`. Runs before the event is read. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(orgId: string, eventId: string): Promise<WorkshopEvent | null>;
  /** `listEventGuests` from `@upskills/firestore`. */
  listEventGuests(orgId: string, eventId: string): Promise<Guest[]>;
}

export function createDashboardEventsGuestsHandler(
  deps: DashboardEventsGuestsDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      // Before the read, so an unauthenticated caller cannot tell a missing
      // event from one that exists. See the module comment.
      await deps.requireAuth(event);

      const orgId = readOrgId(event);
      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const found = await deps.getEvent(orgId, eventId);

      if (found === null) {
        throw eventForbidden();
      }

      const guests = await deps.listEventGuests(orgId, eventId);

      return {
        guests: guests.map(toGuestView),
      } satisfies DashboardEventsGuestsResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
