import type { WorkshopEvent } from '@upskills/models';
import {
  createError,
  getQuery,
  getRouterParam,
  type H3Event,
} from 'h3';
import { badRequest, type ApiErrorData } from '../http-error';

/**
 * The two places a dashboard route learns which org it is acting on.
 *
 * The list and create routes take `?orgId=` explicitly. The `[eventId]` routes
 * must read the event first and learn its `orgId` from the document — but if
 * the event does not exist, they answer 403, exactly like `requireOrgRole`
 * answers for a missing org. A 404 would tell an outsider which event ids
 * exist, which is the leak `requireOrgRole` is written to avoid.
 */

/** The one 403 the dashboard produces for a missing event. */
export function eventForbidden() {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'You do not have access to this resource.',
    data: { error: 'forbidden' } satisfies ApiErrorData,
  });
}

/**
 * `?orgId=` as a non-empty string, or a 400.
 *
 * The query is the route's contract for list and create; a missing or blank
 * value is a malformed request rather than an authorization failure.
 */
export function readOrgId(event: H3Event): string {
  const orgId = getQuery(event)['orgId'];

  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw badRequest(
      'invalid-org-id',
      'Expected a non-empty ?orgId= query parameter.',
    );
  }

  return orgId.trim();
}

/**
 * Read the event named by `:eventId`, or answer the same 403 as everything
 * else that must not reveal whether an event exists.
 *
 * The returned document is what supplies `orgId` to `requireOrgRole`, and for
 * the detail route it is also the response body — reading once and reusing it
 * keeps the guard from having to fetch the org separately.
 */
export async function readEventForOrg(
  event: H3Event,
  getEvent: (eventId: string) => Promise<WorkshopEvent | null>,
): Promise<WorkshopEvent> {
  const eventId = getRouterParam(event, 'eventId');

  if (eventId === undefined || eventId === '') {
    throw eventForbidden();
  }

  const found = await getEvent(eventId);

  if (found === null) {
    throw eventForbidden();
  }

  return found;
}
