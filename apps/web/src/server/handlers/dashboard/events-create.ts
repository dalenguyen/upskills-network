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
import { z } from 'zod';
import { badRequest, toHttpError } from '../http-error';
import { readOrgId } from './dashboard-access';
import { toDashboardEvent, type DashboardEvent } from './events-list';

/**
 * `POST /api/v1/dashboard/events?orgId=` — create an event for one org.
 *
 * The org comes from the query and the creator's authority from the session;
 * neither is taken from the body. Authorization runs before body validation so
 * an unauthenticated caller cannot use a malformed body as a cheaper answer
 * than 401.
 */

export interface DashboardEventsCreateResponse {
  event: DashboardEvent;
}

export interface DashboardEventsCreateDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `createEvent` from `@upskills/firestore`. */
  createEvent(orgId: string, input: CreateEventDraft): Promise<WorkshopEvent>;
}

export function createDashboardEventsCreateHandler(
  deps: DashboardEventsCreateDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = readOrgId(event);
      const orgContext = await deps.requireOrgRole(
        event,
        orgId,
        'admin',
        'manager',
      );

      const parsed = CreateEventSchema.safeParse(
        await readBody<unknown>(event),
      );

      if (!parsed.success) {
        throw badRequest(
          'invalid-event',
          `Expected a JSON body with title, slug, description, startsAt, timezone, price, currency, and maxGuests. ${z.prettifyError(parsed.error)}`,
        );
      }

      // Not `event` — that name is the H3Event this handler was called with,
      // and shadowing it here puts every earlier use of it in this block into
      // the temporal dead zone.
      const created = await deps.createEvent(orgId, {
        ...parsed.data,
        // `createdBy` is the authenticated session uid, never the body, so a
        // caller cannot forge the audit trail by supplying their own uid.
        createdBy: orgContext.uid,
      });

      return {
        event: toDashboardEvent(created),
      } satisfies DashboardEventsCreateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
