import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { readOrgId } from './dashboard-request';
import { toDashboardEvent, type DashboardEvent } from './dashboard-view';

/**
 * `GET /api/v1/dashboard/events?orgId=…` — one org's event list for the
 * dashboard, newest first and regardless of status.
 *
 * ## Every org member may read
 *
 * This is a read route, so `requireOrgRole` is called with every
 * `OrgRole` rather than only the management roles. A `check_in` volunteer needs
 * to see the event they are working; the mutations below are where the narrower
 * `'admin', 'manager'` gate lives.
 */

export interface EventsListResponse {
  events: DashboardEvent[];
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

      await deps.requireOrgRole(
        event,
        orgId,
        'admin',
        'manager',
        'check_in',
        'volunteer',
      );

      const events = await deps.listOrgEvents(orgId);

      return {
        events: events.map(toDashboardEvent),
      } satisfies EventsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
