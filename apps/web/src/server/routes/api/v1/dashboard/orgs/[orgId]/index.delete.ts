import { requireOrgRole } from '@upskills/auth';
import { deleteOrg } from '@upskills/firestore';
import { createDashboardOrgsDeleteHandler } from '../../../../../../handlers/dashboard/orgs-delete';

/**
 * `DELETE /api/v1/dashboard/orgs/:orgId`
 *
 * Wiring only. See `handlers/dashboard/orgs-delete.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardOrgsDeleteHandler({
  requireOrgRole,
  deleteOrg,
});
