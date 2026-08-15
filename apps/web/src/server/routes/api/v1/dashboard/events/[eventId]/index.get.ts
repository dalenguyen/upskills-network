import { requireAuth, requireOrgRole } from '@upskills/auth';
import { getEvent } from '@upskills/firestore';
import { createDashboardEventsDetailHandler } from '../../../../../../handlers/dashboard/events-detail';

/**
 * `GET /api/v1/dashboard/events/:eventId`
 *
 * Wiring only. See `handlers/dashboard/events-detail.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsDetailHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
});
