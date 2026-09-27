import type { PublishedEventsPage } from '@upskills/firestore';
import type { EventTimeframe } from '@upskills/validation';
import { defineEventHandler, getQuery, type EventHandler } from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { rethrowAsBadCursor } from './cursor-error';
import { toPublicEvent, type PublicEvent } from './public-view';
import { parseTimeframe } from './timeframe';

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
 *
 * ## Upcoming by default, `?when=past` for the archive
 *
 * Without `?when=` the listing is what a visitor can still attend. `?when=past`
 * lists the rest, most recent first. A cursor belongs to the timeframe that
 * issued it; pass the same `when` with it.
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
    when?: EventTimeframe;
  }): Promise<PublishedEventsPage>;
  /**
   * `getOrgSlugs` from `@upskills/firestore` — orgId → slug for one page.
   *
   * This listing spans organizers, and every card links to
   * `/{orgSlug}/{eventSlug}`, so the slugs have to come from somewhere. One
   * batched read per page, deduplicated by organizer.
   */
  getOrgSlugs(orgIds: string[]): Promise<Record<string, string>>;
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
      const when = parseTimeframe(query['when']);

      const page = await deps
        .listPublishedEvents({
          cursor,
          ...(limit === undefined ? {} : { limit }),
          ...(when === undefined ? {} : { when }),
        })
        .catch(rethrowAsBadCursor);

      const orgSlugs = await deps.getOrgSlugs(
        page.events.map((published) => published.orgId),
      );

      return {
        // An event whose organizer document has gone missing is dropped rather
        // than rendered: without an org slug there is no URL to link it to, and
        // a card that cannot be clicked is worse than one that is absent.
        events: page.events.flatMap((published) => {
          const orgSlug = orgSlugs[published.orgId];
          return orgSlug ? [toPublicEvent(published, orgSlug)] : [];
        }),
        nextCursor: page.nextCursor,
      } satisfies EventsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
