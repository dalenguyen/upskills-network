import type { WorkshopEvent } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';
import { toPublicEvent, type PublicEvent } from './public-view';

/**
 * `GET /api/v1/events/:slug` — one event's public detail page.
 *
 * ## Draft and "does not exist" answer identically
 *
 * `getEventBySlug` resolves any event, whatever its status. Everything that is
 * not `published` gets the same 404 as a slug nobody has ever reserved: same
 * status, same `error` code, same message.
 *
 * The difference matters. Slugs are guessable — they are derived from titles —
 * and an endpoint that answered 403 for a draft would confirm the existence of
 * unannounced events to anyone willing to try plausible names. That leaks an
 * organizer's schedule before they have chosen to publish it. A cancelled event
 * is hidden for the plainer reason that nobody should be able to reach a
 * registration form for it.
 *
 * The cost of the indistinguishable answer is a slightly worse error for the
 * organizer previewing their own draft, who sees "not found" for something they
 * know exists. That is the dashboard's job to solve, not this route's — the
 * dashboard reads authenticated and can say so plainly.
 */

export interface EventDetailResponse {
  event: PublicEvent;
}

export interface EventDetailDeps {
  /** `getEventBySlug` from `@upskills/firestore`. */
  getEventBySlug(slug: string): Promise<WorkshopEvent | null>;
}

/** The one 404 this route produces, for every reason it produces one. */
function eventNotFound() {
  return notFound('event-not-found', 'No such event.');
}

export function createEventDetailHandler(deps: EventDetailDeps): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    try {
      const slug = getRouterParam(event, 'slug');

      if (slug === undefined || slug === '') {
        throw eventNotFound();
      }

      const found = await deps.getEventBySlug(slug);

      if (found === null || found.status !== 'published') {
        throw eventNotFound();
      }

      return { event: toPublicEvent(found) } satisfies EventDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
