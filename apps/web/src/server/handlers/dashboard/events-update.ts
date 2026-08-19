import type { AuthContext, OrgContext } from '@upskills/auth';
import type { UpdateEventPatch } from '@upskills/firestore';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { UpdateEventSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { eventForbidden, readOrgId } from './dashboard-access';
import { toDashboardEvent, type DashboardEvent } from './events-list';

/**
 * `PUT /api/v1/dashboard/events/:eventId` — update one event owned by one org.
 *
 * Like the detail route, the org is read off the event document before the
 * guard can run; a missing event is therefore the same 403 as an unauthorized
 * one. `requireAuth` runs *before* that read for the reason spelled out in
 * `events-detail.ts`: without it, an unauthenticated caller gets 403 for a
 * missing event and 401 for one that exists, which is the very existence
 * oracle the shared 403 exists to close. Authorization runs before body validation so a caller without access
 * cannot use a malformed body as a cheaper answer than 401.
 *
 * `status: 'cancelled'` is refused here on purpose. `UpdateEventSchema` accepts
 * the full lifecycle, but the data-access patch type excludes `'cancelled'`
 * because cancelling must go through `cancelEvent` — the only path that
 * returns the confirmed guests to notify. Accepting it here would let a route
 * soft-delete an event and silently skip everyone who had a seat.
 */

export interface DashboardEventsUpdateResponse {
  event: DashboardEvent;
}

export interface DashboardEventsUpdateDeps {
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
  /** `updateEvent` from `@upskills/firestore`. */
  updateEvent(
    orgId: string,
    eventId: string,
    patch: UpdateEventPatch,
  ): Promise<WorkshopEvent>;
}

export function createDashboardEventsUpdateHandler(
  deps: DashboardEventsUpdateDeps,
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

      // Authorize before reading — see `events-detail.ts` for why the org now
      // comes from `?orgId=` rather than from the event document.
      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const found = await deps.getEvent(orgId, eventId);

      if (found === null) {
        throw eventForbidden();
      }

      const parsed = UpdateEventSchema.safeParse(
        await readBody<unknown>(event),
      );

      if (!parsed.success) {
        throw badRequest(
          'invalid-event',
          'Expected a JSON body with at least one of title, slug, description, startsAt, endsAt, timezone, location, price, currency, maxGuests, or status.',
        );
      }

      const { status, ...patch } = parsed.data;

      if (status === 'cancelled') {
        throw badRequest(
          'invalid-event',
          'Cancelling an event is a separate route and cannot be applied here.',
        );
      }

      const updated = await deps.updateEvent(orgId, eventId, {
        ...patch,
        ...(status === undefined ? {} : { status }),
      });

      return {
        event: toDashboardEvent(updated),
      } satisfies DashboardEventsUpdateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
