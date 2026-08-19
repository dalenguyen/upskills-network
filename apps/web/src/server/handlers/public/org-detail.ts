import type { PublishedEventsPage } from '@upskills/firestore';
import type { Organizer } from '@upskills/models';
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';
import { rethrowAsBadCursor } from './cursor-error';
import {
  toPublicEvent,
  toPublicOrg,
  type PublicEvent,
  type PublicOrg,
} from './public-view';

/**
 * `GET /api/v1/orgs/:orgSlug` — an organizer's public page: who they are, plus
 * the events of theirs a visitor can still register for.
 *
 * ## An org with nothing published is still a real page
 *
 * Unlike a draft event, an organizer is not a secret: their slug appears on
 * every event they have ever published, so hiding the profile when their
 * current schedule happens to be empty would break a bookmarked link for no
 * benefit. The page answers 200 with an empty `events` array.
 *
 * The events themselves are filtered to `published` in the query, not here, so
 * drafts never leave Firestore.
 */

export interface OrgDetailResponse {
  org: PublicOrg;
  events: PublicEvent[];
  /** Pass back as `?cursor=` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

export interface OrgDetailDeps {
  /** `getOrgBySlug` from `@upskills/firestore`. */
  getOrgBySlug(slug: string): Promise<Organizer | null>;
  /** `listPublishedOrgEvents` from `@upskills/firestore`. */
  listPublishedOrgEvents(
    orgId: string,
    options: { cursor?: string | null },
  ): Promise<PublishedEventsPage>;
}

export function createOrgDetailHandler(deps: OrgDetailDeps): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    try {
      const slug = getRouterParam(event, 'orgSlug');

      if (slug === undefined || slug === '') {
        throw notFound('org-not-found', 'No such organizer.');
      }

      const org = await deps.getOrgBySlug(slug);

      if (org === null) {
        throw notFound('org-not-found', 'No such organizer.');
      }

      const query = getQuery(event);
      const cursor =
        typeof query['cursor'] === 'string' ? query['cursor'] : null;

      const page = await deps
        .listPublishedOrgEvents(org.orgId, { cursor })
        .catch(rethrowAsBadCursor);

      return {
        org: toPublicOrg(org),
        events: page.events.map((published) =>
          toPublicEvent(published, org.slug),
        ),
        nextCursor: page.nextCursor,
      } satisfies OrgDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
