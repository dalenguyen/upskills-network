import { requireAdmin } from '@upskills/auth';
import {
  acceptOrgInvite,
  findUserByEmail,
  getOrg,
  getOrgInvite,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
} from '@upskills/firestore';
import { toAdminOrg } from '../../../../../../../handlers/admin/admin-view';
import { adminAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesConfirmHandler } from '../../../../../../../handlers/invites/org-invites';

/**
 * `POST /api/v1/admin/orgs/:orgId/invites/confirm` — accept on the invitee's
 * behalf.
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesConfirmHandler({
  authorizeOrg: adminAuthorizeOrg({ requireAdmin, getOrg }),
  serializeOrg: toAdminOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  getOrgInvite,
  findUserByEmail,
  acceptOrgInvite,
});
