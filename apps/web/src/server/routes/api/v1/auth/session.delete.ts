import {
  clearedSessionCookie,
  requireAuth,
  revokeSessions,
} from '@upskills/auth';
import { createSessionDeleteHandler } from '../../../../handlers/auth/session-delete';

/**
 * `DELETE /api/v1/auth/session`
 *
 * Wiring only — see `handlers/auth/session-delete.ts` for the behavior and
 * `session.post.ts` for why the split exists.
 */
export default createSessionDeleteHandler({
  requireAuth: (event) => requireAuth(event),
  revokeSessions: (uid) => revokeSessions(uid),
  clearedSessionCookie,
});
