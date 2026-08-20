import { requireAuth, requireOrgRole } from '@upskills/auth';
import { getEvent, listEventGuests } from '@upskills/firestore';
import { createDashboardEventsGuestsHandler } from '../../../../../../handlers/dashboard/events-guests';

/**
 * `GET /api/v1/dashboard/events/:eventId/guests`
 *
 * Wiring only. See `handlers/dashboard/events-guests.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardEventsGuestsHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  listEventGuests,
});
