import { getEventByPath } from '@upskills/firestore';
import { createEventDetailHandler } from '../../../../../../handlers/public/event-detail';

/**
 * `GET /api/v1/orgs/:orgSlug/events/:eventSlug`
 *
 * Wiring only — see `handlers/public/event-detail.ts`.
 */
export default createEventDetailHandler({
  getEventByPath: (orgSlug, eventSlug) => getEventByPath(orgSlug, eventSlug),
});
