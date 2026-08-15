import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { readOrgId } from './event-access';
import { toDashboardEvent, type DashboardEvent } from './event-view';

/**
 * `GET /api/v1/dashboard/events?orgId=…` — every event owned by one org,
 * newest first, regardless of status.
 *
 * This is the organizer's own list, so it includes drafts and cancelled events
 * and carries the live counters. The guard is an org-membership check for every
 * role; the mutation routes below are the ones that narrow to admin/manager.
 */

export interface EventsListResponse {
  events: DashboardEvent[];
}

export interface EventsListDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `listOrgEvents` from `@upskills/firestore`. */
  listOrgEvents(orgId: string): Promise<WorkshopEvent[]>;
}

export function createEventsListHandler(deps: EventsListDeps): EventHandler {
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
