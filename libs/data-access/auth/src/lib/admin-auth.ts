import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

/**
 * The memoized Admin SDK Auth client, for the same reason `getDb()` memoizes
 * Firestore: Cloud Run keeps the instance warm between requests, and building a
 * client per request would re-resolve credentials every time.
 */
let auth: Auth | undefined;

/**
 * Lazily initialize and return the Admin SDK Auth client.
 *
 * ## One app, shared with Firestore
 *
 * `getApps()[0]` is reused rather than initialized blindly, and that reuse is
 * the whole point: `@upskills/firestore`'s `getDb()` initializes the same
 * default app, and whichever of the two runs first wins. A second
 * `initializeApp()` would throw on the duplicate app name, and naming it around
 * that would be worse — two apps mean two credential caches, two token refresh
 * loops, and an emulator setting honored by one of them.
 *
 * ## Credentials
 *
 * **Application Default Credentials only** — never a service-account key file.
 * `initializeApp()` with no `credential` is exactly the ADC path: on Cloud Run
 * that resolves the runtime service account from the metadata server (which
 * needs `roles/firebaseauth.admin` for the session-cookie and custom-claim
 * calls in this library), and locally it is whatever
 * `gcloud auth application-default login` left behind.
 *
 * ## Why there is no emulator branch here
 *
 * `getDb()` needs none because the Admin SDK routes itself at
 * `FIRESTORE_EMULATOR_HOST`. The Auth emulator works the same way through
 * `FIREBASE_AUTH_EMULATOR_HOST` — but this workspace does not run it, and no
 * test in this library dials it. Everything here takes an injectable `auth`
 * instead, so the tests exercise the real logic against a fake client and this
 * function is only ever called in production. See `SessionAuth` and
 * `ClaimsAuth` for the seams.
 */
export function getAdminAuth(): Auth {
  if (auth) {
    return auth;
  }

  const projectId =
    process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

  const app =
    getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);

  auth = getAuth(app);

  return auth;
}
