import { getOrgSlugs, listPublishedEvents } from '@upskills/firestore';
import { createEventsListHandler } from '../../../../handlers/public/events-list';
import {
  PUBLIC_READ_TTL_MS,
  createResponseCache,
  guardPublicRead,
  listingKey,
  publicReadLimiter,
} from '../../../../handlers/public/public-read-guard';

/**
 * `GET /api/v1/events`
 *
 * Wiring only — see `handlers/public/events-list.ts` for the behavior, and
 * `auth/session.post.ts` for why every route in this app is split this way.
 * Rate limited and cached — see `handlers/public/public-read-guard.ts`.
 */
export default guardPublicRead(
  createEventsListHandler({
    listPublishedEvents: (options) => listPublishedEvents(options),
    getOrgSlugs: (orgIds) => getOrgSlugs(orgIds),
  }),
  {
    limiter: publicReadLimiter,
    cache: createResponseCache({ ttlMs: PUBLIC_READ_TTL_MS }),
    keyOf: listingKey,
  },
);
