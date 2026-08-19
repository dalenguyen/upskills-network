import { requireOrgRole } from '@upskills/auth';
import {
  getOrgInvite,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  revokeOrgInvite,
} from '@upskills/firestore';
import { dashboardAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesRevokeHandler } from '../../../../../../../handlers/invites/org-invites';
import { toDashboardOrg } from '../../../../../../../handlers/dashboard/org-view';

/**
 * `DELETE /api/v1/dashboard/orgs/:orgId/invites`
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesRevokeHandler({
  authorizeOrg: dashboardAuthorizeOrg({ requireOrgRole }),
  serializeOrg: toDashboardOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  getOrgInvite,
  revokeOrgInvite,
});
