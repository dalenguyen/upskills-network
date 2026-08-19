import type { EventPage } from '@upskills/firestore';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';
import {
  toPublicEvent,
  toPublicOrg,
  type PublicEvent,
  type PublicOrg,
} from './public-view';

/**
 * `GET /api/v1/orgs/:orgSlug/events/:eventSlug` — one event's public detail
 * page.
 *
 * ## Why the organizer is in the path
 *
 * Event slugs are unique per organizer, not globally, so `react-basics` alone
 * does not name an event. The organizer segment is what resolves it — the same
 * shape as the public URL, `/{orgSlug}/{eventSlug}`.
 *
 * The response carries the organizer too, because `getEventByPath` has already
 * read that document to get there and the page renders the organizer's name;
 * returning only the event would just make the client pay for a second request.
 *
 * ## Draft and "does not exist" answer identically
 *
 * `getEventByPath` resolves any event, whatever its status. Everything that is
 * not `published` gets the same 404 as a slug nobody has ever reserved: same
 * status, same `error` code, same message. A wrong organizer segment answers
 * the same way, so probing cannot even distinguish "no such org" from "no such
 * event of theirs".
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
  org: PublicOrg;
}

export interface EventDetailDeps {
  /** `getEventByPath` from `@upskills/firestore`. */
  getEventByPath(orgSlug: string, eventSlug: string): Promise<EventPage | null>;
}

/** The one 404 this route produces, for every reason it produces one. */
function eventNotFound() {
  return notFound('event-not-found', 'No such event.');
}

export function createEventDetailHandler(deps: EventDetailDeps): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    try {
      const orgSlug = getRouterParam(event, 'orgSlug');
      const eventSlug = getRouterParam(event, 'eventSlug');

      if (!orgSlug || !eventSlug) {
        throw eventNotFound();
      }

      const found = await deps.getEventByPath(orgSlug, eventSlug);

      if (found === null || found.event.status !== 'published') {
        throw eventNotFound();
      }

      return {
        event: toPublicEvent(found.event, found.organizer.slug),
        org: toPublicOrg(found.organizer),
      } satisfies EventDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
