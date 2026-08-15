import { requireAdmin } from '@upskills/auth';
import { createOrg } from '@upskills/firestore';
import { createOrgsCreateHandler } from '../../../../../handlers/admin/orgs-create';

/**
 * `POST /api/v1/admin/orgs`
 *
 * Wiring only. See `handlers/admin/orgs-create.ts` for the behavior and why the
 * real `@upskills/auth` import stays in this file.
 */
export default createOrgsCreateHandler({
  requireAdmin,
  createOrg,
});
