import { requireOrgRole } from '@upskills/auth';
import { createEvent } from '@upskills/firestore';
import { createDashboardEventsCreateHandler } from '../../../../../handlers/dashboard/events-create';

/**
 * `POST /api/v1/dashboard/events?orgId=`
 *
 * Wiring only. See `handlers/dashboard/events-create.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsCreateHandler({
  requireOrgRole,
  createEvent,
});
