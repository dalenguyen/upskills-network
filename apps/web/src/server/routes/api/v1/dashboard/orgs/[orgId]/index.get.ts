import { requireOrgRole } from '@upskills/auth';
import { getUserEmails } from '@upskills/firestore';
import { createDashboardOrgsDetailHandler } from '../../../../../../handlers/dashboard/orgs-detail';

/**
 * `GET /api/v1/dashboard/orgs/:orgId`
 *
 * Wiring only. See `handlers/dashboard/orgs-detail.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardOrgsDetailHandler({
  requireOrgRole,
  getUserEmails,
});
