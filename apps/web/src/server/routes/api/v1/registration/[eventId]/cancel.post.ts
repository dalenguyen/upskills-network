import { sendCancellationEmail, sendSpotOpenedEmail } from '@upskills/email';
import {
  cancelGuest,
  getEvent,
  getGuest,
  promoteNextPending,
} from '@upskills/firestore';
import { createCancelHandler } from '../../../../../handlers/registration/cancel';

/**
 * `POST /api/v1/registration/:eventId/cancel`
 *
 * Wiring only — see `handlers/registration/cancel.ts`.
 */
export default createCancelHandler({
  getGuest: (eventId, email) => getGuest(eventId, email),
  getEvent: (eventId) => getEvent(eventId),
  cancelGuest: (eventId, email) => cancelGuest(eventId, email),
  promoteNextPending: (eventId) => promoteNextPending(eventId),
  sendCancellationEmail: (guest, event) => sendCancellationEmail(guest, event),
  sendSpotOpenedEmail: (guest, event) => sendSpotOpenedEmail(guest, event),
});
