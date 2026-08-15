import type { OrgContext } from '@upskills/auth';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { CreateEventSchema, type CreateEventInput } from '@upskills/validation';
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { readOrgId } from './event-access';
import { toDashboardEvent, type DashboardEvent } from './event-view';

/**
 * `POST /api/v1/dashboard/events?orgId=…` — create one event.
 *
 * ## Authorization first, then the body
 *
 * The guard runs before the body is parsed. A `check_in` or `volunteer` member
 * gets the same 403 for a valid body as for a malformed one, and an outsider
 * learns nothing about the schema from the order in which the route fails.
 *
 * ## The data-access layer owns the write
 *
 * `createEvent` reserves the slug and writes the event document in one
 * transaction. This handler only maps the validated input into that call and
 * projects the committed document for the client.
 */

export interface EventCreateResponse {
  event: DashboardEvent;
}

export interface EventCreateDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `createEvent` from `@upskills/firestore`. */
  createEvent(orgId: string, input: CreateEventInput): Promise<WorkshopEvent>;
}

export function createEventsCreateHandler(
  deps: EventCreateDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = readOrgId(event);

      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const parsed = CreateEventSchema.safeParse(await readBody(event));

      if (!parsed.success) {
        throw badRequest('invalid-event', 'The event body is not valid.');
      }

      const created = await deps.createEvent(orgId, parsed.data);

      setResponseStatus(event, 201);
      return { event: toDashboardEvent(created) } satisfies EventCreateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
