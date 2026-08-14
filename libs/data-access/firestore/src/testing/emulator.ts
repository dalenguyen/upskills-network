import { readFileSync } from 'node:fs';

/**
 * Shared constants and helpers for the Firestore emulator harness.
 *
 * Nothing here imports `firebase-admin`, so `vitest.config.mts` can import it
 * while Vite is still bundling the config.
 */

/**
 * The project id used by every test.
 *
 * The `demo-` prefix is not cosmetic: the Firebase CLI treats such ids as
 * offline demo projects, so the emulator never authenticates, never contacts
 * GCP, and no `firebase login` is required.
 */
export const EMULATOR_PROJECT_ID = 'demo-upskills';

/** Env var name the Admin SDK itself watches to route traffic at the emulator. */
export const EMULATOR_HOST_ENV = 'FIRESTORE_EMULATOR_HOST';

/** Env var carrying the absolute path of `firebase.json` to the global setup. */
export const FIREBASE_CONFIG_ENV = 'UPSKILLS_FIREBASE_CONFIG';

interface FirebaseJson {
  emulators?: { firestore?: { host?: string; port?: number } };
}

/**
 * Read `host:port` for the Firestore emulator out of `firebase.json`.
 *
 * `firebase.json` is the single source of truth: the same file configures the
 * emulator the CLI starts and the address the tests dial, so the two cannot
 * drift apart.
 */
export function readEmulatorHost(firebaseJsonPath: string): string {
  const config = JSON.parse(
    readFileSync(firebaseJsonPath, 'utf8'),
  ) as FirebaseJson;

  const firestore = config.emulators?.firestore;
  if (!firestore?.port) {
    throw new Error(
      `${firebaseJsonPath} has no emulators.firestore.port — the Firestore emulator cannot be started.`,
    );
  }

  return `${firestore.host ?? '127.0.0.1'}:${firestore.port}`;
}

/** The emulator address the current process is pointed at. */
export function emulatorHost(): string {
  const host = process.env[EMULATOR_HOST_ENV];
  if (!host) {
    throw new Error(
      `${EMULATOR_HOST_ENV} is not set — this helper only runs against the Firestore emulator.`,
    );
  }

  return host;
}

/**
 * `true` when the emulator at `host` is up and answering.
 *
 * The Firestore emulator replies `Ok` to `GET /`; anything else on the port is
 * a different program, and the caller must not treat it as an emulator.
 */
export async function isEmulatorReady(host: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}/`, {
      signal: AbortSignal.timeout(2000),
    });

    return response.ok && (await response.text()).trim() === 'Ok';
  } catch {
    return false;
  }
}

/**
 * Delete every document in the emulator for {@link EMULATOR_PROJECT_ID}.
 *
 * Call it in `beforeEach` so each test starts from an empty database. This is
 * the emulator's own bulk-delete endpoint — one request, no recursive walk.
 */
export async function clearFirestore(): Promise<void> {
  // `firebase-admin` is imported dynamically, at call time, on purpose:
  // `vitest.config.mts` imports this module while Vite is still bundling the
  // config, and a static import would drag the Admin SDK into that graph.
  const { getDb } = await import('../lib/db');
  const db = getDb();

  // Deliberately NOT the emulator's `DELETE /emulator/v1/.../documents`
  // endpoint. That answers 200 when the delete is *accepted*, not when it has
  // finished: on a database with real data the sweep is still running after the
  // response lands and goes on to delete documents written after it, so the
  // next test's fixtures are swallowed mid-run and the failure surfaces far
  // away as "Event ... does not exist".
  //
  // `recursiveDelete()` on its own has the same hazard in a subtler form — with
  // an implicit BulkWriter it can resolve while deletes are still in flight, and
  // those stragglers delete documents seeded afterwards. Driving one BulkWriter
  // explicitly and closing it is what makes completion deterministic:
  // `close()` flushes every queued write and resolves only when they have all
  // landed, so when this function returns the database is genuinely empty and
  // nothing is still deleting behind it.
  const writer = db.bulkWriter();
  const collections = await db.listCollections();
  await Promise.all(
    collections.map((collection) => db.recursiveDelete(collection, writer)),
  );
  await writer.close();
}
