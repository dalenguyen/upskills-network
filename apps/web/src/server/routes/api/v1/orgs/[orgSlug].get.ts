import { getOrgBySlug, listPublishedOrgEvents } from '@upskills/firestore';
import { createOrgDetailHandler } from '../../../../handlers/public/org-detail';

/**
 * `GET /api/v1/orgs/:orgSlug`
 *
 * Wiring only — see `handlers/public/org-detail.ts`.
 */
export default createOrgDetailHandler({
  getOrgBySlug: (slug) => getOrgBySlug(slug),
  listPublishedOrgEvents: (orgId, options) =>
    listPublishedOrgEvents(orgId, options),
});
