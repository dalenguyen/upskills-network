import type { AuthContext, OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden, readOrgId } from './dashboard-access';

/**
 * `DELETE /api/v1/dashboard/events/:eventId/permanent?orgId=` — hard-delete a
 * draft event nobody registered for.
 *
 * ## Why this is a second route rather than a flag on the other one
 *
 * `DELETE /api/v1/dashboard/events/:eventId` **cancels**: it keeps the event,
 * keeps every guest document, and emails the confirmed guests. That is the right
 * behavior for anything that was ever public, and it must stay the thing a
 * plain DELETE does — an organizer who guesses gets the safe operation.
 *
 * This route is the other case: an event created by mistake, never published,
 * with nobody registered. Cancelling one of those leaves a permanent tombstone
 * on the dashboard and holds its slug forever. Making the destructive operation
 * a separate URL means it can only be reached deliberately.
 *
 * The two refusals — not a draft, or has guests — are enforced inside
 * `deleteDraftEvent`'s transaction, not here, so a registration landing while
 * the request is in flight cannot slip past a check this handler made earlier.
 * They surface as `EventNotDeletableError` → 409.
 *
 * The slug is released in the same commit as the delete, which is the point:
 * the name an organizer typo'd is immediately free to use again.
 */

export interface DashboardEventsDeleteResponse {
  /** The id of the event that is now gone. */
  eventId: string;
  /** The slug that was released, so the client can offer it back. */
  slug: string;
  deleted: true;
}

export interface DashboardEventsDeleteDeps {
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
  /** `deleteDraftEvent` from `@upskills/firestore`. */
  deleteDraftEvent(orgId: string, eventId: string): Promise<void>;
}

export function createDashboardEventsDeleteHandler(
  deps: DashboardEventsDeleteDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      // Before the read, so an unauthenticated caller cannot tell a missing
      // event from one that exists. See `events-detail.ts`.
      await deps.requireAuth(event);

      const orgId = readOrgId(event);
      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      // Deleting is an admin operation. A `manager` may create, edit, and
      // cancel events; destroying one outright is the one event write reserved
      // for the people who own the organizer.
      await deps.requireOrgRole(event, orgId, 'admin');

      // Read first only to learn the slug, which the response reports and the
      // delete itself does not return. The authorization above already decided
      // whether this caller may be here.
      const found = await deps.getEvent(orgId, eventId);

      if (found === null) {
        throw eventForbidden();
      }

      await deps.deleteDraftEvent(orgId, eventId);

      return {
        eventId,
        slug: found.slug,
        deleted: true,
      } satisfies DashboardEventsDeleteResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
