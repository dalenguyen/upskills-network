import { getEvent, reserveSpot } from '@upskills/firestore';
import { sendWaitlistEmail, sendWelcomeEmail } from '@upskills/email';
import { createRegisterHandler } from '../../../../../../handlers/registration/register';

/**
 * `POST /api/v1/registration/:orgId/:eventId/register`
 *
 * Wiring only — see `handlers/registration/register.ts`.
 */
export default createRegisterHandler({
  getEvent: (orgId, eventId) => getEvent(orgId, eventId),
  reserveSpot: (orgId, eventId, draft) =>
    reserveSpot(orgId, eventId, draft, 'confirm'),
  sendWelcomeEmail: (guest, event) => sendWelcomeEmail(guest, event),
  sendWaitlistEmail: (guest, event, position) =>
    sendWaitlistEmail(guest, event, position),
});
