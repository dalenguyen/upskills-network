import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { readEventForOrg } from './event-access';
import { toDashboardEvent, type DashboardEvent } from './event-view';

/**
 * `GET /api/v1/dashboard/events/:eventId` — one event's full organizer view.
 *
 * The event is read before the guard because its `orgId` is what the guard
 * checks. A missing event answers 403 rather than 404 for the same reason
 * `requireOrgRole` refuses to distinguish a missing org: the difference would
 * let an outsider probe which event ids exist.
 */

export interface EventDetailResponse {
  event: DashboardEvent;
}

export interface EventDetailDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(eventId: string): Promise<WorkshopEvent | null>;
}

export function createEventsDetailHandler(
  deps: EventDetailDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const found = await readEventForOrg(event, deps.getEvent);

      await deps.requireOrgRole(
        event,
        found.orgId,
        'admin',
        'manager',
        'check_in',
        'volunteer',
      );

      return {
        event: toDashboardEvent(found),
      } satisfies EventDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
