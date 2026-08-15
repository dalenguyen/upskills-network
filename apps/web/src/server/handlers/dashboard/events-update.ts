import type { OrgContext } from '@upskills/auth';
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
import { eventForbidden } from './dashboard-access';

/**
 * `PUT /api/v1/dashboard/events/:eventId` — update one event owned by one org.
 *
 * Like the detail route, the org is read off the event document before the
 * guard can run; a missing event is therefore the same 403 as an unauthorized
 * one. Authorization runs before body validation so a caller without access
 * cannot use a malformed body as a cheaper answer than 401.
 *
 * `status: 'cancelled'` is refused here on purpose. `UpdateEventSchema` accepts
 * the full lifecycle, but the data-access patch type excludes `'cancelled'`
 * because cancelling must go through `cancelEvent` — the only path that
 * returns the confirmed guests to notify. Accepting it here would let a route
 * soft-delete an event and silently skip everyone who had a seat.
 */

export interface DashboardEventsUpdateResponse {
  event: WorkshopEvent;
}

export interface DashboardEventsUpdateDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(eventId: string): Promise<WorkshopEvent | null>;
  /** `updateEvent` from `@upskills/firestore`. */
  updateEvent(eventId: string, patch: UpdateEventPatch): Promise<WorkshopEvent>;
}

export function createDashboardEventsUpdateHandler(
  deps: DashboardEventsUpdateDeps,
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

      const updated = await deps.updateEvent(eventId, {
        ...patch,
        ...(status === undefined ? {} : { status }),
      });

      return { event: updated } satisfies DashboardEventsUpdateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
