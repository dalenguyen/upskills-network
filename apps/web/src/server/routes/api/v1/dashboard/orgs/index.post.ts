import { requireAuth } from '@upskills/auth';
import { createOrg } from '@upskills/firestore';
import { createDashboardOrgsCreateHandler } from '../../../../../handlers/dashboard/orgs-create';

/**
 * `POST /api/v1/dashboard/orgs`
 *
 * Wiring only. See `handlers/dashboard/orgs-create.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 */
export default createDashboardOrgsCreateHandler({
  requireAuth,
  createOrg,
});
