import { requireAdmin } from '@upskills/auth';
import { removeOrgMember } from '@upskills/firestore';
import { createOrgMembersRemoveHandler } from '../../../../../../handlers/admin/org-members-remove';

/**
 * `DELETE /api/v1/admin/orgs/:orgId/members`
 *
 * Wiring only. See `handlers/admin/org-members-remove.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createOrgMembersRemoveHandler({
  requireAdmin,
  removeOrgMember,
});
