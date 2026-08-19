import { requireAuth, requireOrgRole } from '@upskills/auth';
import { deleteDraftEvent, getEvent } from '@upskills/firestore';
import { createDashboardEventsDeleteHandler } from '../../../../../../handlers/dashboard/events-delete';

/**
 * `DELETE /api/v1/dashboard/events/:eventId/permanent?orgId=`
 *
 * Wiring only. See `handlers/dashboard/events-delete.ts` for the behavior and
 * why this is separate from the cancelling `DELETE` next to it.
 */
export default createDashboardEventsDeleteHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  deleteDraftEvent,
});
