import { requireAdmin } from '@upskills/auth';
import { setOrgMember } from '@upskills/firestore';
import { createOrgMembersSetHandler } from '../../../../../../handlers/admin/org-members-set';

/**
 * `POST /api/v1/admin/orgs/:orgId/members`
 *
 * Wiring only. See `handlers/admin/org-members-set.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createOrgMembersSetHandler({
  requireAdmin,
  setOrgMember,
});
