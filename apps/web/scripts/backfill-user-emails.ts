import { usersCol } from '@upskills/firestore';
import { fileURLToPath } from 'node:url';
import { backfillUserEmails } from '../src/server/scripts/backfill-user-emails';

/**
 * One-off backfill: normalize `users/{uid}.email` in place.
 *
 * `users/{uid}.email` was stored exactly as the identity provider sent it, so
 * users who signed in with a mixed-case address have an email that no
 * normalized lookup will find. This walks the `users` collection and, for each
 * document whose email differs from `normalizeEmail(email)`, updates only that
 * field. Firestore's `update()` merges the single field, so `role`, `orgIds`,
 * and `createdAt` are left exactly as they are.
 *
 * Idempotent: a second run finds every email already normalized and writes
 * nothing.
 *
 * Run from the repo root with a TypeScript runner that resolves the workspace
 * path aliases (the same aliases Vite uses for the server bundle).
 */
async function main(): Promise<void> {
  const snapshot = await usersCol().get();
  const users = snapshot.docs.map((doc) => ({
    uid: doc.id,
    email: doc.data().email,
  }));

  const rewritten = await backfillUserEmails({
    listUsers: async () => users,
    rewriteEmail: async (uid, email) => {
      await usersCol().doc(uid).update({ email });
    },
  });

  console.log(`Backfilled ${rewritten} user document(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('User email backfill failed:', error);
    process.exitCode = 1;
  });
}
