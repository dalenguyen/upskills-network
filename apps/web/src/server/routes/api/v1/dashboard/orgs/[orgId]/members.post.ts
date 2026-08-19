import { requireOrgRole } from '@upskills/auth';
import {
  findUserByEmail,
  getUserEmails,
  setOrgMember,
} from '@upskills/firestore';
import { createDashboardOrgMembersSetHandler } from '../../../../../../handlers/dashboard/org-members-set';

/**
 * `POST /api/v1/dashboard/orgs/:orgId/members`
 *
 * Wiring only. See `handlers/dashboard/org-members-set.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardOrgMembersSetHandler({
  requireOrgRole,
  setOrgMember,
  findUserByEmail,
  getUserEmails,
});
