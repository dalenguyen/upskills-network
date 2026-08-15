import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { readOrgId } from './dashboard-access';

/**
 * `GET /api/v1/dashboard/events?orgId=` — every event owned by one org.
 *
 * The dashboard shows drafts too, so this is `listOrgEvents` (all statuses,
 * newest first), not the public `listPublishedOrgEvents`. `?orgId=` is the
 * route contract and is read first because the guard needs it; authorization
 * then runs before the read.
 */

/**
 * An event as the dashboard sees it.
 *
 * Every field of {@link WorkshopEvent} except that the three `Timestamp`s are
 * ISO-8601 strings. This is the same reason {@link PublicEvent} carries strings
 * — a Firestore `Timestamp` does not survive JSON intact. It serializes to
 * `{"_seconds":…,"_nanoseconds":…}`, a plain object with no `toDate()`, so a
 * browser that trusted the `WorkshopEvent` type would compile, pass its tests
 * against a hand-built fixture, and then throw `startsAt.toDate is not a
 * function` on the first org that actually has an event.
 *
 * Unlike `PublicEvent` this is not a narrowing: the dashboard is the
 * organizer's own view and every field is theirs to see. Only the wire format
 * differs.
 */
export interface DashboardEvent extends Omit<
  WorkshopEvent,
  'startsAt' | 'endsAt' | 'createdAt' | 'updatedAt'
> {
  /** ISO-8601 — see the interface comment. */
  startsAt: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardEventsListResponse {
  events: DashboardEvent[];
}

/** Serialize one event for the dashboard, timestamps included. */
export function toDashboardEvent(event: WorkshopEvent): DashboardEvent {
  const { startsAt, endsAt, createdAt, updatedAt, ...rest } = event;

  return {
    ...rest,
    startsAt: startsAt.toDate().toISOString(),
    ...(endsAt === undefined ? {} : { endsAt: endsAt.toDate().toISOString() }),
    createdAt: createdAt.toDate().toISOString(),
    updatedAt: updatedAt.toDate().toISOString(),
  };
}

export interface DashboardEventsListDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `listOrgEvents` from `@upskills/firestore`. */
  listOrgEvents(orgId: string): Promise<WorkshopEvent[]>;
}

export function createDashboardEventsListHandler(
  deps: DashboardEventsListDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = readOrgId(event);
      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const events = await deps.listOrgEvents(orgId);

      return {
        events: events.map(toDashboardEvent),
      } satisfies DashboardEventsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
