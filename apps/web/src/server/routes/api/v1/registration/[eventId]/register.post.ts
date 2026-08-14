import { getEvent, reserveSpot } from '@upskills/firestore';
import { sendWaitlistEmail, sendWelcomeEmail } from '@upskills/email';
import { createRegisterHandler } from '../../../../../handlers/registration/register';

/**
 * `POST /api/v1/registration/:eventId/register`
 *
 * Wiring only — see `handlers/registration/register.ts`.
 */
export default createRegisterHandler({
  getEvent: (eventId) => getEvent(eventId),
  reserveSpot: (eventId, draft) => reserveSpot(eventId, draft, 'confirm'),
  sendWelcomeEmail: (guest, event) => sendWelcomeEmail(guest, event),
  sendWaitlistEmail: (guest, event, position) =>
    sendWaitlistEmail(guest, event, position),
});
