import { getOrgBySlug, listPublishedOrgEvents } from '@upskills/firestore';
import { getRouterParam } from 'h3';
import { createOrgDetailHandler } from '../../../../handlers/public/org-detail';
import {
  PUBLIC_READ_TTL_MS,
  createResponseCache,
  guardPublicRead,
  listingKey,
  publicReadLimiter,
} from '../../../../handlers/public/public-read-guard';

/**
 * `GET /api/v1/orgs/:orgSlug`
 *
 * Wiring only — see `handlers/public/org-detail.ts`. Rate limited and cached —
 * see `handlers/public/public-read-guard.ts`.
 */
export default guardPublicRead(
  createOrgDetailHandler({
    getOrgBySlug: (slug) => getOrgBySlug(slug),
    listPublishedOrgEvents: (orgId, options) =>
      listPublishedOrgEvents(orgId, options),
  }),
  {
    limiter: publicReadLimiter,
    cache: createResponseCache({ ttlMs: PUBLIC_READ_TTL_MS }),
    keyOf: (event) =>
      JSON.stringify([
        getRouterParam(event, 'orgSlug') ?? '',
        listingKey(event),
      ]),
  },
);
