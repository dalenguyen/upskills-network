import { requireAuth } from '@upskills/auth';
import { getOrg, getUser } from '@upskills/firestore';
import { createMeGetHandler } from '../../../../handlers/auth/me-get';

/**
 * `GET /api/v1/auth/me`
 *
 * Wiring only — see `handlers/auth/me-get.ts` for the behavior and
 * `session.post.ts` for why the split exists.
 */
export default createMeGetHandler({
  requireAuth: (event) => requireAuth(event),
  getUser: (uid) => getUser(uid),
  getOrg: (orgId) => getOrg(orgId),
});
