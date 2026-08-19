import { requireAdmin } from '@upskills/auth';
import {
  getOrg,
  getOrgInvite,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  revokeOrgInvite,
} from '@upskills/firestore';
import { toAdminOrg } from '../../../../../../../handlers/admin/admin-view';
import { adminAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesRevokeHandler } from '../../../../../../../handlers/invites/org-invites';

/**
 * `DELETE /api/v1/admin/orgs/:orgId/invites`
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesRevokeHandler({
  authorizeOrg: adminAuthorizeOrg({ requireAdmin, getOrg }),
  serializeOrg: toAdminOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  getOrgInvite,
  revokeOrgInvite,
});
