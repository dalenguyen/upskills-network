import type { AuthContext, OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden } from './dashboard-access';
import { toDashboardEvent, type DashboardEvent } from './events-list';

/**
 * `GET /api/v1/dashboard/events/:eventId` — one event owned by one org.
 *
 * The org is learned from the event document, never from the request, so the
 * event must be read before `requireOrgRole` can run. A missing event and an
 * event the caller cannot see are both answered with {@link eventForbidden}, so
 * probing event ids cannot learn which ones exist.
 *
 * ## Why `requireAuth` runs before the event is read
 *
 * Answering the same 403 for both cases is not enough on its own. Without an
 * auth check first, an **unauthenticated** caller gets 403 for a missing event
 * (from {@link eventForbidden}) but 401 for one that exists (from
 * `requireOrgRole`, which verifies the session before it looks at membership).
 * Two different statuses is exactly the oracle this handler is trying not to
 * be. Requiring a session up front collapses that: no session is always 401,
 * whatever the event id, and only a caller who is already signed in can reach
 * the read at all.
 */

export interface DashboardEventsDetailResponse {
  event: DashboardEvent;
}

export interface DashboardEventsDetailDeps {
  /** `requireAuth` from `@upskills/auth`. Runs before the event is read. */
  requireAuth(event: H3Event): Promise<AuthContext>;
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
      // Before the read, so an unauthenticated caller cannot tell a missing
      // event from one that exists. See the module comment.
      await deps.requireAuth(event);

      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      const found = await deps.getEvent(eventId);

      if (found === null) {
        throw eventForbidden();
      }

      await deps.requireOrgRole(event, found.orgId, 'admin', 'manager');

      return {
        event: toDashboardEvent(found),
      } satisfies DashboardEventsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
