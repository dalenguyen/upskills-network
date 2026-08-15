import { requireAuth, requireOrgRole } from '@upskills/auth';
import { getEvent, updateEvent } from '@upskills/firestore';
import { createDashboardEventsUpdateHandler } from '../../../../../../handlers/dashboard/events-update';

/**
 * `PUT /api/v1/dashboard/events/:eventId`
 *
 * Wiring only. See `handlers/dashboard/events-update.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsUpdateHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  updateEvent,
});
