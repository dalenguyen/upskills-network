import { getEventBySlug } from '@upskills/firestore';
import { createEventDetailHandler } from '../../../../handlers/public/event-detail';

/**
 * `GET /api/v1/events/:slug`
 *
 * Wiring only — see `handlers/public/event-detail.ts`.
 */
export default createEventDetailHandler({
  getEventBySlug: (slug) => getEventBySlug(slug),
});
