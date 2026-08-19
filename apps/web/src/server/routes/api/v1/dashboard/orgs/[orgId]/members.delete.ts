import { requireOrgRole } from '@upskills/auth';
import { getUserEmails, removeOrgMember } from '@upskills/firestore';
import { createDashboardOrgMembersRemoveHandler } from '../../../../../../handlers/dashboard/org-members-remove';

/**
 * `DELETE /api/v1/dashboard/orgs/:orgId/members`
 *
 * Wiring only. See `handlers/dashboard/org-members-remove.ts` for the behavior
 * and why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardOrgMembersRemoveHandler({
  requireOrgRole,
  removeOrgMember,
  getUserEmails,
});
