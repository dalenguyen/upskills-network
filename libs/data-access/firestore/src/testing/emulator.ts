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
  const response = await fetch(
    `http://${emulatorHost()}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to clear the Firestore emulator: ${response.status} ${await response.text()}`,
    );
  }
}
