import { getQuery, getRouterParam, type H3Event } from 'h3';
import { badRequest } from '../http-error';

/**
 * The two identifiers every dashboard route starts from.
 *
 * `orgId` comes from the query for the collection routes; `eventId` comes from
 * the path for the item routes. Both are required and must be non-empty, and a
 * malformed request answers 400 before any authorization work happens.
 */

export function readOrgId(event: H3Event): string {
  const orgId = getQuery(event)['orgId'];

  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw badRequest(
      'invalid-org-id',
      'The orgId query parameter is required.',
    );
  }

  return orgId.trim();
}

export function readEventId(event: H3Event): string {
  const eventId = getRouterParam(event, 'eventId');

  if (eventId === undefined || eventId.trim() === '') {
    throw badRequest(
      'invalid-event-id',
      'The eventId path parameter is required.',
    );
  }

  return eventId;
}
