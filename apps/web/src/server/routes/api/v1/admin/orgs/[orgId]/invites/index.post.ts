import { requireAdmin } from '@upskills/auth';
import { sendOrgInviteEmail } from '@upskills/email';
import {
  createOrgInvite,
  getOrg,
  getUser,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
} from '@upskills/firestore';
import { toAdminOrg } from '../../../../../../../handlers/admin/admin-view';
import { adminAuthorizeOrg } from '../../../../../../../handlers/invites/authorize-org';
import { createOrgInvitesCreateHandler } from '../../../../../../../handlers/invites/org-invites';

/**
 * `POST /api/v1/admin/orgs/:orgId/invites`
 *
 * Wiring only. See `handlers/invites/org-invites.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgInvitesCreateHandler({
  authorizeOrg: adminAuthorizeOrg({ requireAdmin, getOrg }),
  serializeOrg: toAdminOrg,
  getUserEmails,
  listOrgInvites,
  orgInviteStatus,
  createOrgInvite,
  getUser,
  sendOrgInviteEmail,
});
