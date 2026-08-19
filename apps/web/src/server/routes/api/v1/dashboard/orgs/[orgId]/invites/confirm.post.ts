import { requireOrgRole } from '@upskills/auth';
import {
  acceptOrgInvite,
  findUserByEmail,
  getOrgInvite,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
} from '@upskills/firestore';
import { dashboardAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesConfirmHandler } from '../../../../../../../handlers/invites/org-invites';
import { toDashboardOrg } from '../../../../../../../handlers/dashboard/org-view';

/**
 * `POST /api/v1/dashboard/orgs/:orgId/invites/confirm` — accept on the
 * invitee's behalf.
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesConfirmHandler({
  authorizeOrg: dashboardAuthorizeOrg({ requireOrgRole }),
  serializeOrg: toDashboardOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  getOrgInvite,
  findUserByEmail,
  acceptOrgInvite,
});
