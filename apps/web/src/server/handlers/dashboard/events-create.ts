import type { OrgContext } from '@upskills/auth';
import type { CreateEventDraft } from '@upskills/firestore';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { CreateEventSchema } from '@upskills/validation';
import {
  defineEventHandler,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { readOrgId } from './dashboard-request';
import { toDashboardEvent, type DashboardEvent } from './dashboard-view';

/**
 * `POST /api/v1/dashboard/events?orgId=…` — create an event for an org.
 *
 * ## The org comes from the query, never the body
 *
 * `CreateEventSchema` deliberately has no `orgId` field, so a client cannot
 * create an event for an org it named in the payload. The query org is what the
 * role guard authorizes against, and it is the org written to the event.
 */

export interface CreateEventResponse {
  event: DashboardEvent;
}

export interface DashboardEventCreateDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `createEvent` from `@upskills/firestore`. */
  createEvent(orgId: string, input: CreateEventDraft): Promise<WorkshopEvent>;
}

export function createDashboardEventCreateHandler(
  deps: DashboardEventCreateDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = readOrgId(event);

      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const parsed = CreateEventSchema.safeParse(await readBody(event));

      if (!parsed.success) {
        throw badRequest(
          'invalid-event',
          'The event body is missing required fields or has invalid values.',
        );
      }

      const created = await deps.createEvent(orgId, parsed.data);

      return { event: toDashboardEvent(created) } satisfies CreateEventResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
