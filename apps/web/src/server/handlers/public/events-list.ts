import type { PublishedEventsPage } from '@upskills/firestore';
import { defineEventHandler, getQuery, type EventHandler } from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { rethrowAsBadCursor } from './cursor-error';
import { toPublicEvent, type PublicEvent } from './public-view';

/**
 * `GET /api/v1/events` — the public browse listing.
 *
 * ## Pagination is a cursor, never an offset
 *
 * `?cursor=` carries the position after the last event of the previous page.
 * An offset would re-scan from the start on every page — cost growing with
 * depth — and, worse, would shift under the reader: an event published while
 * someone is on page 2 pushes one event from page 2 down into page 3, so it
 * appears twice, and one from page 3 is never seen. The cursor addresses a
 * fixed `(startsAt, eventId)` position, so pages stay disjoint.
 *
 * A malformed cursor answers 400 — see {@link rethrowAsBadCursor}.
 */

export interface EventsListResponse {
  events: PublicEvent[];
  /** Pass back as `?cursor=` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

export interface EventsListDeps {
  /** `listPublishedEvents` from `@upskills/firestore`. */
  listPublishedEvents(options: {
    cursor?: string | null;
    limit?: number;
  }): Promise<PublishedEventsPage>;
}

/**
 * Read `?limit=`, which may legitimately be absent.
 *
 * Only a syntactically invalid value is rejected. An out-of-range number is
 * clamped by the read helper rather than refused, because "give me 5000" has an
 * obvious correct answer (the maximum page) and failing the request instead
 * would be pedantry.
 */
function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }

  const limit = Number(raw);

  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest('invalid-limit', 'limit must be a positive integer.');
  }

  return limit;
}

export function createEventsListHandler(deps: EventsListDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const query = getQuery(event);
      const cursor =
        typeof query['cursor'] === 'string' ? query['cursor'] : null;
      const limit = parseLimit(query['limit']);

      const page = await deps
        .listPublishedEvents({
          cursor,
          ...(limit === undefined ? {} : { limit }),
        })
        .catch(rethrowAsBadCursor);

      return {
        events: page.events.map(toPublicEvent),
        nextCursor: page.nextCursor,
      } satisfies EventsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
