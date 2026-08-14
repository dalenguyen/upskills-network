import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * The memoized client. Module scope is the right lifetime: Cloud Run keeps the
 * instance warm between requests, and re-initializing per request would open a
 * new gRPC channel every time.
 */
let db: Firestore | undefined;

/**
 * Lazily initialize and return the Admin SDK Firestore client.
 *
 * ## Credentials
 *
 * **Application Default Credentials only** — never a service-account key file.
 * On Cloud Run that is the runtime service account, resolved from the metadata
 * server; locally it is whatever `gcloud auth application-default login` left
 * behind. `initializeApp()` with no `credential` is exactly the ADC path.
 *
 * ## Emulator
 *
 * There is deliberately **no branch** between test and production. When
 * `FIRESTORE_EMULATOR_HOST` is set, the Admin SDK itself routes all traffic to
 * that host over an insecure channel and never asks ADC for a token; when it is
 * unset, the same code talks to real Firestore with real credentials. The only
 * difference between the two environments is an environment variable, so the
 * code under test is byte-for-byte the code that runs in production.
 *
 * The project id comes from `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` when set
 * (the test harness sets a `demo-` project id, which the emulator requires to
 * stay fully offline). When neither is set, the SDK auto-detects it from ADC —
 * which is what happens on Cloud Run.
 */
export function getDb(): Firestore {
  if (db) {
    return db;
  }

  const projectId =
    process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

  const app =
    getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);

  db = getFirestore(app);
  // Optional model fields (`endsAt`, `holdExpiresAt`, …) are `undefined` rather
  // than absent when they are spread from a partial; without this every write
  // touching one would throw. Must be set before the first read/write.
  db.settings({ ignoreUndefinedProperties: true });

  return db;
}
