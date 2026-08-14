/**
 * The Firebase **web** config, read from Vite build-time environment.
 *
 * ## Not a secret, but not a constant either
 *
 * The four values below ship inside the client bundle and are visible to anyone
 * who opens devtools — that is by design; Firebase's browser security rests on
 * Auth and on security rules, not on hiding the project id. So they are plain
 * `VITE_*` env vars rather than Secret Manager entries (see issue #18).
 *
 * They are still *configuration*: staging and production are different Firebase
 * projects, and a hardcoded `apiKey` is how a staging build ends up writing to
 * production Auth. Vite substitutes `import.meta.env.VITE_…` at build time, so
 * each build carries the config of the environment it was built for.
 *
 * ## Why the accesses are spelled out one by one
 *
 * Vite performs a **textual** replacement of `import.meta.env.VITE_FOO`. Reading
 * the object dynamically — `env[name]`, or destructuring it into a local first —
 * works in the dev server and silently yields `undefined` in a production build.
 * Hence {@link readFirebaseWebConfig} naming every key literally.
 */

declare global {
  /**
   * Declared explicitly (rather than relying on Vite's `Record<string, any>`
   * fallback) for two reasons: the app compiles with
   * `noPropertyAccessFromIndexSignature`, and a typo in a key name should be a
   * compile error rather than a config that is silently absent at runtime.
   */
  interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
  }
}

/** The public web config for a Firebase project. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** The env vars a build must set for browser sign-in to work at all. */
export const FIREBASE_CONFIG_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

/** The four values as the build supplied them, before validation. */
export interface FirebaseWebConfigEnv {
  apiKey: string | undefined;
  authDomain: string | undefined;
  projectId: string | undefined;
  appId: string | undefined;
}

/**
 * The literal `import.meta.env` reads, isolated in one function.
 *
 * Split out from {@link readFirebaseWebConfig} so the validation rules can be
 * tested against supplied values. The reads themselves cannot be: Vite
 * substitutes `import.meta.env.VITE_…` during transform, which happens under
 * Vitest too, so `vi.stubEnv` cannot reach them. What a unit test can prove is
 * that four present values are accepted, a partial set is not, and an
 * unconfigured build yields `null` — the last of which does exercise the real
 * reads, since that is the state the test environment is in.
 */
export function firebaseWebConfigEnv(): FirebaseWebConfigEnv {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

/**
 * The configured Firebase web config, or `null` when this build has none.
 *
 * ## Why `null` instead of throwing
 *
 * This runs while Angular builds the injector, so a throw here takes down the
 * whole app — including every page that needs no authentication at all. A
 * workspace checkout with no `.env` should still `nx serve` and render the
 * public site; only the sign-in paths should fail, and they fail with a message
 * naming the missing variables (see `AuthUnavailableError`).
 *
 * All four keys are required together: a partial config produces a Firebase
 * initialisation error deep inside the SDK on first use, which is a much worse
 * signal than "not configured".
 */
export function readFirebaseWebConfig(
  env: FirebaseWebConfigEnv = firebaseWebConfigEnv(),
): FirebaseWebConfig | null {
  const apiKey = trimmed(env.apiKey);
  const authDomain = trimmed(env.authDomain);
  const projectId = trimmed(env.projectId);
  const appId = trimmed(env.appId);

  if (
    apiKey === undefined ||
    authDomain === undefined ||
    projectId === undefined ||
    appId === undefined
  ) {
    return null;
  }

  return { apiKey, authDomain, projectId, appId };
}

/**
 * An env var, or `undefined` when missing or blank.
 *
 * Blank is treated as missing because that is what an unset variable looks like
 * after a CI template substitutes nothing into it, and `initializeApp` with an
 * empty `apiKey` fails later and further from the cause.
 */
function trimmed(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}
