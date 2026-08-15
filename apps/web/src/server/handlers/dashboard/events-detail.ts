import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden } from './dashboard-access';

/**
 * `GET /api/v1/dashboard/events/:eventId` — one event owned by one org.
 *
 * The org is learned from the event document, never from the request, so the
 * event must be read before `requireOrgRole` can run. That order is the point:
 * a missing event and an event the caller cannot see are both answered with
 * {@link eventForbidden}, so probing event ids cannot learn which ones exist.
 */

export interface DashboardEventsDetailResponse {
  event: WorkshopEvent;
}

export interface DashboardEventsDetailDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(eventId: string): Promise<WorkshopEvent | null>;
}

export function createDashboardEventsDetailHandler(
  deps: DashboardEventsDetailDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      const found = await deps.getEvent(eventId);

      if (found === null) {
        throw eventForbidden();
      }

      await deps.requireOrgRole(event, found.orgId, 'admin', 'manager');

      return { event: found } satisfies DashboardEventsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
