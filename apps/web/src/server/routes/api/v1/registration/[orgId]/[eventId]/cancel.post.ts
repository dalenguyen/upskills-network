import { sendCancellationEmail, sendSpotOpenedEmail } from '@upskills/email';
import {
  cancelGuest,
  getEvent,
  getGuest,
  promoteNextPending,
} from '@upskills/firestore';
import { createCancelHandler } from '../../../../../../handlers/registration/cancel';

/**
 * `POST /api/v1/registration/:orgId/:eventId/cancel`
 *
 * Wiring only — see `handlers/registration/cancel.ts`.
 */
export default createCancelHandler({
  getGuest: (orgId, eventId, email) => getGuest(orgId, eventId, email),
  getEvent: (orgId, eventId) => getEvent(orgId, eventId),
  cancelGuest: (orgId, eventId, email) => cancelGuest(orgId, eventId, email),
  promoteNextPending: (orgId, eventId) => promoteNextPending(orgId, eventId),
  sendCancellationEmail: (guest, event) => sendCancellationEmail(guest, event),
  sendSpotOpenedEmail: (guest, event) => sendSpotOpenedEmail(guest, event),
});
