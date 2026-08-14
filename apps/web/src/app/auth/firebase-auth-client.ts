import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID, type Provider } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';

import { AUTH_CLIENT, type AuthClient } from './auth-client';
import { readFirebaseWebConfig } from './firebase-config';

/**
 * The one file that imports `firebase/auth`, and the only place the SDK is
 * initialised.
 *
 * ## SSR
 *
 * This is an AnalogJS app: `app.config.ts` is evaluated during server-side
 * rendering too. Importing the modular SDK in Node is safe — its entrypoints
 * only register components — but *initialising* it is not useful there and
 * `getAuth()` reaches for browser storage. So {@link provideFirebaseAuth}
 * returns `null` unless it is running in a browser, and `AuthService` treats a
 * `null` client as "no browser session", which is exactly right during SSR: a
 * server render authorizes from the `__session` cookie, never from client SDK
 * state.
 */

/**
 * Install the browser Firebase Auth client.
 *
 * Add to `app.config.ts`. It is a no-op on the server and in a build with no
 * Firebase web config, in both cases leaving {@link AUTH_CLIENT} as `null`.
 *
 * ## Known cost: this is a static import, so it ships on every page
 *
 * Measured on the production build: the entry chunk goes from 266 kB to 373 kB
 * (82.3 kB to 113.9 kB gzipped). Public pages that never authenticate pay it
 * too.
 *
 * Fixing it means `import('firebase/auth')` behind a lazy adapter *and* an
 * `AuthService` that attaches its auth-state listener on first use rather than
 * in its constructor — the listener is what would otherwise pull the chunk in
 * at bootstrap regardless. That is a change to the seam the sign-in invariant
 * rests on, so it is deliberately not bundled into the ticket that establishes
 * the invariant. Do it as its own change, with these tests still green.
 */
export function provideFirebaseAuth(): Provider {
  return {
    provide: AUTH_CLIENT,
    useFactory: (): AuthClient | null => {
      if (!isPlatformBrowser(inject(PLATFORM_ID))) {
        return null;
      }

      const config = readFirebaseWebConfig();
      if (config === null) {
        return null;
      }

      // `getApps()` rather than an unconditional `initializeApp`: HMR in the
      // dev server re-evaluates this module against a live SDK, and a second
      // `initializeApp` for the same name throws.
      const app = getApps().length > 0 ? getApp() : initializeApp(config);

      return createFirebaseAuthClient(getAuth(app));
    },
  };
}

/**
 * Adapt the modular SDK to the {@link AuthClient} port.
 *
 * Exported for a test that wants the real adapter over a fake `Auth`; the app
 * only ever gets here through {@link provideFirebaseAuth}.
 */
export function createFirebaseAuthClient(auth: Auth): AuthClient {
  return {
    get currentUser() {
      // A getter, not a captured value: `auth.currentUser` changes underneath
      // us on every sign-in, sign-out and token refresh.
      return auth.currentUser;
    },

    onAuthStateChanged: (next) => onAuthStateChanged(auth, next),

    /**
     * Popup rather than redirect, and that choice is load-bearing.
     *
     * The server refuses to mint a session cookie from a sign-in older than
     * five minutes, so the ID token must be exchanged in the same flow as the
     * sign-in. A popup keeps the whole flow inside one `await` in one function,
     * where forgetting the exchange is impossible. A redirect flow finishes on
     * a *subsequent page load* via `getRedirectResult()`, which puts the
     * exchange in bootstrap code — the exact shape the five-minute rule exists
     * to discourage, and one that breaks whenever a user takes their time on
     * the Google consent screen.
     */
    signInWithGoogle: async () => {
      const provider = new GoogleAuthProvider();
      // Without this, a browser with one Google session signs the user straight
      // back in after "sign out", which reads as the button being broken.
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      return credential.user;
    },

    signInWithEmail: async (email, password) => {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      return credential.user;
    },

    registerWithEmail: async (email, password) => {
      // Account creation lives here and only here. There is deliberately no
      // server-side registration route (issue #39): two creation paths drift,
      // leaving Firebase Auth and Firestore disagreeing about who exists. The
      // client registers; the session exchange creates the `users/{uid}` doc.
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      return credential.user;
    },

    signOut: () => signOut(auth),
  };
}
