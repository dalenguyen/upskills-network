import { createSessionCookie, verifySessionCookie } from '@upskills/auth';
import { createUserIfAbsent } from '@upskills/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { createSessionPostHandler } from '../../../../handlers/auth/session-post';
import { upsertUserOnSignIn } from '../../../../handlers/auth/user-upsert';

/**
 * `POST /api/v1/auth/session`
 *
 * Wiring only. The handler and everything worth testing live in
 * `handlers/auth/session-post.ts`, because `@upskills/auth` cannot be imported
 * at runtime under Vitest (`firebase-admin/auth` → `jwks-rsa` → `require('jose')`,
 * and `jose` ships ESM from a CommonJS-marked package — see
 * `src/server/alias-smoke.spec.ts`). Keeping the real imports in this file and
 * nothing else means the spec can load the handler without them.
 */
export default createSessionPostHandler({
  createSessionCookie: (idToken) => createSessionCookie(idToken),
  verifySessionCookie: (cookie) => verifySessionCookie(cookie),
  upsertUser: (identity) =>
    upsertUserOnSignIn(identity, {
      createUserIfAbsent,
      now: () => Timestamp.now(),
    }),
});
