import {
  getEvent,
  getOrg,
  getUserEmails,
  reserveSpot,
} from '@upskills/firestore';
import {
  sendOrganizerNotification,
  sendWaitlistEmail,
  sendWelcomeEmail,
} from '@upskills/email';
import { createOrganizerNotifier } from '../../../../../../handlers/organizer-notify';
import { createRegisterHandler } from '../../../../../../handlers/registration/register';

/**
 * `POST /api/v1/registration/:orgId/:eventId/register`
 *
 * Wiring only — see `handlers/registration/register.ts`.
 */
export default createRegisterHandler({
  getEvent: (orgId, eventId) => getEvent(orgId, eventId),
  getOrg: (orgId) => getOrg(orgId),
  reserveSpot: (orgId, eventId, draft) =>
    reserveSpot(orgId, eventId, draft, 'confirm'),
  sendWelcomeEmail: (guest, event, orgSlug) =>
    sendWelcomeEmail(guest, event, orgSlug),
  sendWaitlistEmail: (guest, event, position, orgSlug) =>
    sendWaitlistEmail(guest, event, position, orgSlug),
  notifyOrganizers: createOrganizerNotifier({
    getOrg: (orgId) => getOrg(orgId),
    getUserEmails: (uids) => getUserEmails(uids),
    sendOrganizerNotification: (recipients, event, type, details) =>
      sendOrganizerNotification(recipients, event, type, details),
  }),
});
