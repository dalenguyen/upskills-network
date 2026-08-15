import { requireAdmin } from '@upskills/auth';
import { listOrgs } from '@upskills/firestore';
import { createOrgsListHandler } from '../../../../../handlers/admin/orgs-list';

/**
 * `GET /api/v1/admin/orgs`
 *
 * Wiring only. See `handlers/admin/orgs-list.ts` for the behavior and why the
 * real `@upskills/auth` import stays in this file.
 */
export default createOrgsListHandler({
  requireAdmin,
  listOrgs,
});
