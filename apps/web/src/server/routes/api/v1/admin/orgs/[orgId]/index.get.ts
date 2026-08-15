import { requireAdmin } from '@upskills/auth';
import { getOrg } from '@upskills/firestore';
import { createOrgsDetailHandler } from '../../../../../../handlers/admin/orgs-detail';

/**
 * `GET /api/v1/admin/orgs/:orgId`
 *
 * Wiring only. See `handlers/admin/orgs-detail.ts` for the behavior and why the
 * real `@upskills/auth` import stays in this file.
 */
export default createOrgsDetailHandler({
  requireAdmin,
  getOrg,
});
