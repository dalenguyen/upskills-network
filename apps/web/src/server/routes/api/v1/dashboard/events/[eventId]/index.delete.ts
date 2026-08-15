import { requireAuth, requireOrgRole } from '@upskills/auth';
import { sendCancellationEmail } from '@upskills/email';
import { cancelEvent, getEvent } from '@upskills/firestore';
import { createDashboardEventsCancelHandler } from '../../../../../../handlers/dashboard/events-cancel';

/**
 * `DELETE /api/v1/dashboard/events/:eventId`
 *
 * Wiring only. See `handlers/dashboard/events-cancel.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsCancelHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  cancelEvent,
  sendCancellationEmail,
});
