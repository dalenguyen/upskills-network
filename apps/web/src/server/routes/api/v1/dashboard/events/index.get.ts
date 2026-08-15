import { requireOrgRole } from '@upskills/auth';
import { listOrgEvents } from '@upskills/firestore';
import { createDashboardEventsListHandler } from '../../../../../handlers/dashboard/events-list';

/**
 * `GET /api/v1/dashboard/events?orgId=`
 *
 * Wiring only. See `handlers/dashboard/events-list.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsListHandler({
  requireOrgRole,
  listOrgEvents,
});
