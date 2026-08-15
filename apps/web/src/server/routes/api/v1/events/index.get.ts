import { listPublishedEvents } from '@upskills/firestore';
import { createEventsListHandler } from '../../../../handlers/public/events-list';

/**
 * `GET /api/v1/events`
 *
 * Wiring only — see `handlers/public/events-list.ts` for the behavior, and
 * `auth/session.post.ts` for why every route in this app is split this way.
 */
export default createEventsListHandler({
  listPublishedEvents: (options) => listPublishedEvents(options),
});
