import { createError, getQuery, type H3Event } from 'h3';
import { badRequest, type ApiErrorData } from '../http-error';

/**
 * Shared dashboard-route plumbing.
 *
 * `readOrgId` is the `?orgId=` contract for the org-scoped dashboard routes:
 * a missing value is a malformed request (400), not an authorization failure.
 * `eventForbidden` is the single 403 the `[eventId]` routes answer for a
 * missing event, so #117 and #118 do not each invent one.
 */

/** Read the `?orgId=` query parameter required by the dashboard routes. */
export function readOrgId(event: H3Event): string {
  const query = getQuery(event);
  const orgId = query['orgId'];

  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw badRequest(
      'invalid-org-id',
      'Expected a non-empty ?orgId= query parameter.',
    );
  }

  return orgId.trim();
}

/** The shared 403 an event route answers when the event does not exist. */
export function eventForbidden() {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'You do not have access to this resource.',
    data: { error: 'forbidden' } satisfies ApiErrorData,
  });
}
