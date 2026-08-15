import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { BehaviorSubject, filter, firstValueFrom, type Observable } from 'rxjs';

import { AUTH_CLIENT, type AuthClient, type ClientUser } from './auth-client';
import {
  AuthUnavailableError,
  SessionExchangeError,
  sessionRejectionReasonFrom,
} from './auth-errors';
import { FIREBASE_CONFIG_ENV_KEYS } from './firebase-config';

/**
 * The server route that mints and clears the `__session` cookie.
 *
 * POST `{ idToken }` and the response carries a `Set-Cookie`; DELETE clears it
 * and revokes the user's refresh tokens. Both are same-origin, so the browser
 * attaches and stores the cookie without anything on this side asking it to.
 *
 * The `/v1` is not decoration — it is where the routes live
 * (`src/server/routes/api/v1/auth/session.{post,delete}.ts`), alongside every
 * other API route in this app.
 *
 * The POST answers `{ uid, role, created }`. Nothing here reads it: `role` is
 * only knowable at the moment of exchange, and a field on {@link AuthUser} that
 * is populated after sign-in but absent after a session is restored from
 * storage is a field every consumer has to special-case. Anything needing the
 * platform role should ask `GET /api/v1/auth/me`, which can answer at any time.
 */
export const SESSION_ENDPOINT = '/api/v1/auth/session';

/**
 * A signed-in identity, as a plain snapshot.
 *
 * Deliberately *not* the SDK's `User`: that object carries `getIdToken()`, and
 * anything holding one can mint a bearer credential and pass it around. The one
 * place an ID token is legitimately needed is the exchange below, which reads
 * it from the SDK directly. Everything else — a template, a guard, a header
 * component — gets these four fields and no capability.
 */
export interface AuthUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly emailVerified: boolean;
}

/**
 * Browser-side authentication: Firebase Auth for sign-in, and the exchange that
 * turns a sign-in into the `__session` cookie every server route and SSR render
 * actually reads.
 *
 * ## The five-minute rule shapes this whole class
 *
 * `createSessionCookie` on the server refuses an ID token whose `auth_time` is
 * more than five minutes old, answering 401 `stale-sign-in`. That check is what
 * stops an hour-long ID token lifted off a compromised device from being
 * upgraded into a five-day, revocable-only session.
 *
 * The consequence here is a design constraint, not a note: **the exchange must
 * happen inside the sign-in flow**. Every one of {@link loginWithGoogle},
 * {@link loginWithEmail} and {@link registerWithEmail} runs it before it
 * resolves, and none of them resolves successfully without it. A caller cannot
 * forget to exchange, because there is no way to reach a signed-in state
 * through this service that skips it. That is also why nothing in this file
 * calls {@link exchangeForSession} lazily — not from a route guard noticing a
 * missing cookie, not from an app initializer, not on the first request that
 * gets a 401. All of those run at a time nobody chose, which is to say usually
 * more than five minutes after the tab was opened.
 *
 * ## What this class does not know
 *
 * The session cookie is `HttpOnly`. This code cannot read it, does not try, and
 * keeps no shadow copy of "am I signed in on the server" in `localStorage` — a
 * mirror like that is only ever a second source of truth to disagree with the
 * first. {@link authState$} reports what the Firebase client SDK believes; the
 * cookie is the server's business, and the server re-checks it on every request.
 *
 * ## During SSR
 *
 * There is no client SDK on the server, so {@link AUTH_CLIENT} is `null`,
 * {@link authState$} stays `null`, and the sign-in methods throw
 * {@link AuthUnavailableError}. A server render that needs to know who the user
 * is reads the cookie, not this service.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client: AuthClient | null = inject(AUTH_CLIENT);
  private readonly http = inject(HttpClient);

  private readonly state = new BehaviorSubject<AuthUser | null>(null);
  private readonly userSignal = signal<AuthUser | null>(null);

  /**
   * Whether Firebase has reported for the first time.
   *
   * On a hard refresh the SDK restores a persisted session asynchronously, so
   * for the first moments after bootstrap `null` means "not known yet", not
   * "signed out". Anything that would *act* on being signed out — a guard
   * redirecting to the login page — has to wait for this; see
   * {@link currentUser}. {@link authState$} does not wait, because a header
   * rendering a signed-out state for one frame is fine and blocking it is not.
   */
  private readonly resolved = new BehaviorSubject(false);

  /**
   * Sign-in state, starting at `null` and updated on every change.
   *
   * Reflects sign-out immediately: {@link logout} pushes `null` as soon as the
   * SDK's `signOut()` resolves, without waiting for the network call that tears
   * the server session down, and without waiting for the SDK's own listener to
   * fire.
   */
  readonly authState$: Observable<AuthUser | null> = this.state.asObservable();

  /** {@link authState$} as a signal, for templates and computed state. */
  readonly user = this.userSignal.asReadonly();

  constructor() {
    if (this.client === null) {
      // SSR, or a build with no Firebase config. There is no state to track and
      // nothing will ever resolve it — say so, so `currentUser()` does not hang.
      this.resolved.next(true);
      return;
    }

    const unsubscribe = this.client.onAuthStateChanged((user) => {
      this.setState(user === null ? null : toAuthUser(user));
      this.resolved.next(true);
    });

    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /**
   * Sign in with Google, then exchange the sign-in for a session cookie.
   *
   * Resolves only once the server has accepted the exchange, so a resolved
   * promise means both halves of the credential exist. See
   * {@link exchangeForSession} for what happens when the second half fails.
   */
  async loginWithGoogle(): Promise<AuthUser> {
    const client = this.requireClient();
    return this.completeSignIn(client, await client.signInWithGoogle());
  }

  /** Sign in with an email and password, then exchange for a session cookie. */
  async loginWithEmail(email: string, password: string): Promise<AuthUser> {
    const client = this.requireClient();
    return this.completeSignIn(
      client,
      await client.signInWithEmail(email, password),
    );
  }

  /**
   * Create an account, then exchange for a session cookie.
   *
   * Firebase signs the new account in as part of creating it, so this is a
   * sign-in path like the other two and carries the same obligation to
   * exchange. The `users/{uid}` document is created by the server on the first
   * exchange, which is why registration has no second step here.
   */
  async registerWithEmail(email: string, password: string): Promise<AuthUser> {
    const client = this.requireClient();
    return this.completeSignIn(
      client,
      await client.registerWithEmail(email, password),
    );
  }

  /**
   * Sign out here and on the server.
   *
   * Order matters. The local sign-out happens first and {@link authState$}
   * reports it immediately — the UI must not sit on a spinner, or worse keep
   * showing a signed-in header, while a DELETE crosses the network. The DELETE
   * follows, because only the server can clear an `HttpOnly` cookie and revoke
   * the refresh tokens that make the cookie outlive it.
   *
   * If the DELETE fails this still throws, and the caller should surface it:
   * local state is signed out but the server session survives until it expires
   * or is revoked, which is a real difference on a shared machine.
   */
  async logout(): Promise<void> {
    if (this.client !== null) {
      try {
        await this.client.signOut();
      } finally {
        // The SDK listener normally does this a moment later. Doing it here as
        // well makes sign-out observable the instant `signOut()` resolves, and
        // covers a client whose listener is slow or absent.
        this.setState(null);
      }
    }

    try {
      await firstValueFrom(
        this.http.delete(SESSION_ENDPOINT, { withCredentials: true }),
      );
    } catch (error) {
      throw asSessionExchangeError(
        error,
        'Signed out in this browser, but the server session could not be torn down.',
      );
    }
  }

  /**
   * POST the current ID token to {@link SESSION_ENDPOINT} and let the server set
   * the `__session` cookie.
   *
   * ## Call this only immediately after a sign-in
   *
   * The server rejects an ID token whose sign-in is more than five minutes old
   * with 401 `stale-sign-in`. Every sign-in method on this service already
   * calls it, in the same flow, before it resolves — so ordinary code never
   * needs to. It is public for the one case that is not ordinary: a flow that
   * re-authenticates the user by some other means (a reauthentication prompt
   * before a sensitive action) and must upgrade the fresh sign-in immediately.
   *
   * Calling it "to make sure we have a cookie" on a page load, from a guard, or
   * on a 401 will pass in development against a tab opened seconds ago and fail
   * in production against a tab someone left open over lunch. If the cookie is
   * gone, the user signs in again; that is the intended recovery.
   *
   * The token is read with `getIdToken()` and not `getIdToken(true)`: a forced
   * refresh produces a newer token but the *same* `auth_time`, so it cannot
   * rescue a stale sign-in — it would only add a network round trip to the
   * critical path.
   *
   * ## On failure
   *
   * The client is signed out before this throws. A browser holding a Firebase
   * session with no matching cookie is the worst of the available states: every
   * guarded page renders signed-in, every server read 401s, and nothing in the
   * UI explains why. Signing out makes the failure legible and the recovery
   * obvious.
   */
  async exchangeForSession(): Promise<void> {
    const client = this.requireClient();
    const user = client.currentUser;

    if (user === null) {
      throw new AuthUnavailableError(
        'Cannot exchange for a session cookie: nobody is signed in.',
      );
    }

    await this.exchange(client, user);
  }

  /**
   * The current user, once Firebase has restored any persisted session.
   *
   * Use this — not a first value off {@link authState$} — anywhere a decision is
   * made about a signed-out user, because immediately after bootstrap
   * `authState$` is `null` only because nothing has been restored yet.
   */
  async currentUser(): Promise<AuthUser | null> {
    await firstValueFrom(this.resolved.pipe(filter(Boolean)));
    return this.state.value;
  }

  /**
   * The half of every sign-in path that cannot be skipped.
   *
   * Private on purpose: the exchange is not a step a caller sequences, it is
   * part of what "signed in" means in this app.
   */
  private async completeSignIn(
    client: AuthClient,
    user: ClientUser,
  ): Promise<AuthUser> {
    await this.exchange(client, user);

    const authUser = toAuthUser(user);
    // The SDK listener will report this too. Setting it here means the promise
    // resolves with the app already in the signed-in state, so a caller that
    // navigates on resolution cannot race the listener.
    this.setState(authUser);
    return authUser;
  }

  private async exchange(client: AuthClient, user: ClientUser): Promise<void> {
    let idToken: string;
    try {
      idToken = await user.getIdToken();
    } catch (error) {
      await this.abandonSignIn(client);
      throw new SessionExchangeError(
        0,
        undefined,
        'Could not read an ID token for the session exchange.',
        error,
      );
    }

    try {
      await firstValueFrom(
        this.http.post(
          SESSION_ENDPOINT,
          { idToken },
          { withCredentials: true },
        ),
      );
    } catch (error) {
      await this.abandonSignIn(client);
      throw asSessionExchangeError(
        error,
        'Signed in, but the server refused to issue a session.',
      );
    }
  }

  /**
   * Undo a sign-in whose exchange failed.
   *
   * The sign-out is best-effort: if it fails too, the exchange failure is the
   * one worth reporting, and swallowing this one keeps the original error and
   * its reason from being replaced by a secondary symptom. The observable state
   * is cleared either way, so nothing downstream believes it is signed in.
   */
  private async abandonSignIn(client: AuthClient): Promise<void> {
    try {
      await client.signOut();
    } catch {
      // Intentionally ignored — see above.
    } finally {
      this.setState(null);
    }
  }

  private requireClient(): AuthClient {
    if (this.client === null) {
      throw new AuthUnavailableError(
        'Firebase Auth is unavailable in this context. During server-side rendering this is expected — authorization reads the session cookie instead. ' +
          `In a browser it means the web config is missing: set ${FIREBASE_CONFIG_ENV_KEYS.join(', ')}.`,
      );
    }
    return this.client;
  }

  /**
   * Publish a state change, skipping no-ops.
   *
   * The SDK listener and the sign-in/sign-out paths both report the same
   * transition, so without this every sign-out would emit `null` twice and any
   * subscriber that navigates or refetches on change would do it twice.
   */
  private setState(user: AuthUser | null): void {
    if (sameUser(this.state.value, user)) {
      return;
    }
    this.state.next(user);
    this.userSignal.set(user);
  }
}

/**
 * Whether two states are the same, field by field.
 *
 * Comparing uids alone would be shorter and wrong: the SDK re-reports the same
 * user when the profile changes, and `emailVerified` flipping to `true` after a
 * verification link is followed is exactly the update a UI is waiting on.
 */
function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.uid === b.uid &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.emailVerified === b.emailVerified
  );
}

function toAuthUser(user: ClientUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

/**
 * Turn an `HttpClient` failure into a {@link SessionExchangeError}.
 *
 * A status of `0` means the request never got an answer — offline, DNS, CORS —
 * which is worth keeping distinct from a 401, because one is retryable and the
 * other means sign in again.
 */
function asSessionExchangeError(
  error: unknown,
  message: string,
): SessionExchangeError {
  if (error instanceof HttpErrorResponse) {
    const reason = sessionRejectionReasonFrom(error.error);
    return new SessionExchangeError(
      error.status,
      reason,
      reason === undefined ? message : `${message} (${reason})`,
      error,
    );
  }

  return new SessionExchangeError(0, undefined, message, error);
}
