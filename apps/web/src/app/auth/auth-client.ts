import { InjectionToken } from '@angular/core';

/**
 * The slice of the Firebase **client** SDK this app uses, as an interface.
 *
 * ## Why a port rather than importing `firebase/auth` in the service
 *
 * The modular SDK exposes free functions (`signInWithPopup(auth, provider)`),
 * not methods, so the only way to substitute it in a test is to intercept the
 * module — `vi.mock('firebase/auth', …)`. That kind of test asserts against a
 * mock of a module graph rather than against a contract, and it breaks whenever
 * Firebase moves an export. Naming the four operations this app actually
 * performs gives the service one seam, lets a test hand it a plain object, and
 * keeps every `firebase/*` import inside `firebase-auth-client.ts`.
 *
 * It also draws the SSR line in a single place: {@link AUTH_CLIENT} is `null`
 * on the server, so nothing in the service can reach a browser-only API by
 * accident.
 *
 * Note this is the *client* SDK. `@upskills/auth` wraps `firebase-admin` and is
 * server-only — importing it here would pull the Admin SDK, and eventually a
 * service-account credential, into a browser bundle.
 */

/**
 * The signed-in identity as the browser SDK knows it.
 *
 * Structurally a subset of Firebase's `User`, so the real implementation can
 * return the SDK object unchanged and a fake can be an object literal.
 */
export interface ClientUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly emailVerified: boolean;
  /**
   * The ID token to exchange for a session cookie.
   *
   * `forceRefresh` buys a token with a newer `iat`; it does **not** move
   * `auth_time`, which is the claim the server's staleness check reads. See
   * `AuthService.exchangeForSession`.
   */
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/** Everything `AuthService` needs from Firebase Auth in the browser. */
export interface AuthClient {
  /** The currently signed-in user, or `null`. */
  readonly currentUser: ClientUser | null;
  /**
   * Subscribe to sign-in state. Fires once with the restored (or absent)
   * session shortly after startup, and on every change after that. Returns the
   * unsubscribe function.
   */
  onAuthStateChanged(next: (user: ClientUser | null) => void): () => void;
  signInWithGoogle(): Promise<ClientUser>;
  signInWithEmail(email: string, password: string): Promise<ClientUser>;
  registerWithEmail(email: string, password: string): Promise<ClientUser>;
  signOut(): Promise<void>;
}

/**
 * The Firebase client SDK, or `null` where there is none.
 *
 * `null` is the default rather than an error because it is the correct value in
 * two ordinary situations: a server-side render, where there is no browser and
 * no persisted session to restore, and a build with no Firebase web config. The
 * real implementation is installed by `provideFirebaseAuth()` from
 * `firebase-auth-client.ts`, which applies both of those guards itself.
 */
export const AUTH_CLIENT = new InjectionToken<AuthClient | null>(
  'AUTH_CLIENT',
  {
    providedIn: 'root',
    factory: () => null,
  },
);
