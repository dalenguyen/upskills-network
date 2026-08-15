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

export interface DashboardEventsListResponse {
  events: WorkshopEvent[];
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

      return {
        events: await deps.listOrgEvents(orgId),
      } satisfies DashboardEventsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
