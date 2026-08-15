import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { UpdateEventSchema, type UpdateEventInput } from '@upskills/validation';
import {
  defineEventHandler,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { readEventForOrg } from './event-access';
import { toDashboardEvent, type DashboardEvent } from './event-view';

/**
 * `PUT /api/v1/dashboard/events/:eventId` — apply a partial update.
 *
 * The event is read before the guard so its `orgId` can be authorized, and a
 * missing event is a 403 (see `event-access.ts`). The write itself re-reads the
 * event inside its transaction; the pre-read here is only for authorization.
 *
 * `UpdateEventSchema` already refuses an empty body and enforces
 * `endsAt >= startsAt`, so this handler never re-declares those rules.
 */

export interface EventUpdateResponse {
  event: DashboardEvent;
}

export interface EventUpdateDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(eventId: string): Promise<WorkshopEvent | null>;
  /** `updateEvent` from `@upskills/firestore`. */
  updateEvent(eventId: string, patch: UpdateEventInput): Promise<WorkshopEvent>;
}

export function createEventsUpdateHandler(
  deps: EventUpdateDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const found = await readEventForOrg(event, deps.getEvent);

      await deps.requireOrgRole(event, found.orgId, 'admin', 'manager');

      const parsed = UpdateEventSchema.safeParse(await readBody(event));

      if (!parsed.success) {
        throw badRequest('invalid-event', 'The event update is not valid.');
      }

      const updated = await deps.updateEvent(found.eventId, parsed.data);

      return { event: toDashboardEvent(updated) } satisfies EventUpdateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
