import { requireOrgRole } from '@upskills/auth';
import { sendOrgInviteEmail } from '@upskills/email';
import {
  createOrgInvite,
  getUser,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
} from '@upskills/firestore';
import { dashboardAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesCreateHandler } from '../../../../../../../handlers/invites/org-invites';
import { toDashboardOrg } from '../../../../../../../handlers/dashboard/org-view';

/**
 * `POST /api/v1/dashboard/orgs/:orgId/invites`
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesCreateHandler({
  authorizeOrg: dashboardAuthorizeOrg({ requireOrgRole }),
  serializeOrg: toDashboardOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  createOrgInvite,
  getUser,
  sendOrgInviteEmail,
});
