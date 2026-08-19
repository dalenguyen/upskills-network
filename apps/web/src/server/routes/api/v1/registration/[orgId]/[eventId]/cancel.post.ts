import {
  sendCancellationEmail,
  sendOrganizerNotification,
  sendSpotOpenedEmail,
} from '@upskills/email';
import {
  cancelGuest,
  getEvent,
  getGuest,
  getOrg,
  getUserEmails,
  promoteNextPending,
} from '@upskills/firestore';
import { createOrganizerNotifier } from '../../../../../../handlers/organizer-notify';
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
  notifyOrganizers: createOrganizerNotifier({
    getOrg: (orgId) => getOrg(orgId),
    getUserEmails: (uids) => getUserEmails(uids),
    sendOrganizerNotification: (recipients, event, type, details) =>
      sendOrganizerNotification(recipients, event, type, details),
  }),
});
