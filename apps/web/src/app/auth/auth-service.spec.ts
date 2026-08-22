import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AUTH_CLIENT, type AuthClient, type ClientUser } from './auth-client';
import { AuthUnavailableError, SessionExchangeError } from './auth-errors';
import { AuthService, SESSION_ENDPOINT, type AuthUser } from './auth-service';

/**
 * The Firebase client SDK and the HTTP boundary are both faked here: no real
 * Firebase, no credentials, no network.
 *
 * The SDK fake implements the {@link AuthClient} port rather than mocking the
 * `firebase/auth` module, so these tests assert against the contract the
 * service was written to and not against a snapshot of Firebase's exports.
 */
class FakeAuthClient implements AuthClient {
  currentUser: ClientUser | null = null;

  /** What `getIdToken()` returns. Renamed per sign-in so ordering is provable. */
  idToken = 'id-token-after-sign-in';

  /** Every operation the service performed, in order. */
  readonly calls: string[] = [];

  signOutFailure: unknown = undefined;
  getIdTokenFailure: unknown = undefined;

  /**
   * Whether auth-state callbacks are delivered at all.
   *
   * Real Firebase reports the restored session shortly *after* bootstrap, and
   * says nothing until then. Setting this to `false` models that window, where
   * "no user" and "not known yet" are different things.
   */
  reporting = true;

  private readonly listeners = new Set<(user: ClientUser | null) => void>();

  onAuthStateChanged(next: (user: ClientUser | null) => void): () => void {
    this.listeners.add(next);
    if (this.reporting) {
      next(this.currentUser);
    }
    return () => {
      this.listeners.delete(next);
    };
  }

  /** Firebase finishes restoring and starts reporting. */
  beginReporting(): void {
    this.reporting = true;
    this.notify();
  }

  /** The SDK re-reporting the same user after a verification link is followed. */
  verifyEmail(): void {
    if (this.currentUser === null) {
      throw new Error('nobody is signed in');
    }
    this.currentUser = { ...this.currentUser, emailVerified: true };
    this.notify();
  }

  async signInWithGoogle(): Promise<ClientUser> {
    this.calls.push('signInWithGoogle');
    return this.become('google-uid', 'someone@gmail.com');
  }

  async signInWithEmail(email: string, password: string): Promise<ClientUser> {
    this.calls.push(`signInWithEmail(${email}, ${password})`);
    return this.become('email-uid', email);
  }

  async registerWithEmail(
    email: string,
    password: string,
  ): Promise<ClientUser> {
    this.calls.push(`registerWithEmail(${email}, ${password})`);
    return this.become('new-uid', email);
  }

  async signOut(): Promise<void> {
    this.calls.push('signOut');
    if (this.signOutFailure !== undefined) {
      throw this.signOutFailure;
    }
    this.currentUser = null;
    this.notify();
  }

  private become(uid: string, email: string): ClientUser {
    const user: ClientUser = {
      uid,
      email,
      displayName: 'Test Person',
      emailVerified: false,
      getIdToken: async () => {
        this.calls.push('getIdToken');
        if (this.getIdTokenFailure !== undefined) {
          throw this.getIdTokenFailure;
        }
        return this.idToken;
      },
    };
    this.currentUser = user;
    this.notify();
    return user;
  }

  private notify(): void {
    if (!this.reporting) {
      return;
    }
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }
}

/** Let every pending microtask run, so an in-flight request reaches the mock. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuthService', () => {
  let client: FakeAuthClient;

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AUTH_CLIENT, useValue: client },
      ],
    });
  }

  function emitted(service: AuthService): (AuthUser | null)[] {
    const seen: (AuthUser | null)[] = [];
    service.authState$.subscribe((user) => seen.push(user));
    return seen;
  }

  beforeEach(() => {
    client = new FakeAuthClient();
  });

  describe('sign-in exchanges for a session cookie', () => {
    /**
     * The acceptance criterion, for each provider: signing in produces an
     * exchange call. The service is the only thing that can guarantee this —
     * nothing in the app calls `exchangeForSession` by hand.
     */
    const signInPaths: {
      name: string;
      run: (service: AuthService) => Promise<AuthUser>;
      uid: string;
    }[] = [
      {
        name: 'loginWithGoogle',
        run: (service) => service.loginWithGoogle(),
        uid: 'google-uid',
      },
      {
        name: 'loginWithEmail',
        run: (service) => service.loginWithEmail('a@b.com', 'pw'),
        uid: 'email-uid',
      },
      {
        name: 'registerWithEmail',
        run: (service) => service.registerWithEmail('a@b.com', 'pw'),
        uid: 'new-uid',
      },
    ];

    for (const { name, run, uid } of signInPaths) {
      it(`${name} posts the ID token to the session route`, async () => {
        configure();
        const service = TestBed.inject(AuthService);
        const http = TestBed.inject(HttpTestingController);

        const signedIn = run(service);
        await settle();

        const request = http.expectOne(SESSION_ENDPOINT);
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({
          idToken: 'id-token-after-sign-in',
        });
        expect(request.request.withCredentials).toBe(true);

        request.flush({ uid });
        await expect(signedIn).resolves.toMatchObject({ uid });
        http.verify();
      });
    }

    /**
     * The five-minute rule made testable: the token has to be read *after* the
     * sign-in that produced it, and posted in the same flow. An implementation
     * that deferred the exchange to a later page load would satisfy neither
     * this ordering nor the "still pending" assertion below.
     */
    it('reads the token after signing in, and does not resolve until the exchange lands', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);

      let settled = false;
      const signedIn = service.loginWithGoogle().finally(() => {
        settled = true;
      });
      await settle();

      expect(client.calls).toEqual(['signInWithGoogle', 'getIdToken']);
      expect(settled).toBe(false);

      http.expectOne(SESSION_ENDPOINT).flush({});
      await signedIn;
      expect(settled).toBe(true);
      http.verify();
    });

    it('reports the signed-in user on authState$', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      const seen = emitted(service);

      const signedIn = service.loginWithEmail('a@b.com', 'pw');
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush({});
      await signedIn;

      expect(seen).toEqual([
        null,
        {
          uid: 'email-uid',
          email: 'a@b.com',
          displayName: 'Test Person',
          emailVerified: false,
        },
      ]);
      expect(service.user()?.uid).toBe('email-uid');
      // The credentials reached the SDK unchanged.
      expect(client.calls[0]).toBe('signInWithEmail(a@b.com, pw)');
      http.verify();
    });

    /**
     * The SDK re-reports the same uid when the profile changes, and
     * `emailVerified` flipping to `true` is the update a "please verify your
     * email" banner is waiting on. A uid-only comparison would swallow it.
     */
    it('reports a profile change for the already signed-in user', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);

      const signedIn = service.loginWithGoogle();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush({});
      await signedIn;

      const seen = emitted(service);
      client.verifyEmail();

      expect(seen.at(-1)).toMatchObject({
        uid: 'google-uid',
        emailVerified: true,
      });
      expect(service.user()?.emailVerified).toBe(true);
      http.verify();
    });
  });

  describe('a refused exchange', () => {
    /**
     * The state this guards against: a browser holding a Firebase session with
     * no session cookie. Every guarded page would render as signed in and every
     * server read would 401.
     */
    it('signs the client out and reports the reason', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      const seen = emitted(service);

      const signedIn = service.loginWithGoogle();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush(
        // The literal body Nitro serialises for `unauthorized('stale-sign-in')`
        // in `src/server/handlers/http-error.ts`, top-level `error: true` and
        // all.
        {
          error: true,
          url: 'https://host/api/v1/auth/session',
          statusCode: 401,
          statusMessage: 'Unauthorized',
          message: 'Sign in again.',
          data: { error: 'invalid-session', reason: 'stale-sign-in' },
        },
        { status: 401, statusText: 'Unauthorized' },
      );

      const error = await signedIn.catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SessionExchangeError);
      expect((error as SessionExchangeError).status).toBe(401);
      expect((error as SessionExchangeError).reason).toBe('stale-sign-in');
      // The one that must never become a retry loop: a refreshed token carries
      // the same `auth_time`, so re-exchanging fails identically forever.
      expect((error as SessionExchangeError).retryable).toBe(false);

      // Signed out here, not merely "not signed in": the SDK was told.
      expect(client.calls).toContain('signOut');
      expect(client.currentUser).toBeNull();
      expect(service.user()).toBeNull();
      expect(seen.at(-1)).toBeNull();
      await expect(service.currentUser()).resolves.toBeNull();
      http.verify();
    });

    it('signs the client out when the request never reaches the server', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);

      const signedIn = service.loginWithGoogle();
      await settle();
      http
        .expectOne(SESSION_ENDPOINT)
        .error(new ProgressEvent('offline'), { status: 0 });

      const error = await signedIn.catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SessionExchangeError);
      expect((error as SessionExchangeError).status).toBe(0);
      expect((error as SessionExchangeError).reason).toBeUndefined();
      expect(client.currentUser).toBeNull();
      http.verify();
    });

    /**
     * A sign-out that fails on the way out of a failed exchange must not
     * replace the exchange failure with its own symptom, and must still leave
     * the app looking signed out.
     */
    it('keeps the exchange failure when the rollback sign-out also fails', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      client.signOutFailure = new Error('network');

      const signedIn = service.loginWithGoogle();
      await settle();
      http
        .expectOne(SESSION_ENDPOINT)
        .flush({}, { status: 500, statusText: 'Server Error' });

      const error = await signedIn.catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SessionExchangeError);
      expect((error as SessionExchangeError).status).toBe(500);
      expect(service.user()).toBeNull();
      http.verify();
    });

    it('never posts a token it could not read', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      client.getIdTokenFailure = new Error('token unavailable');

      await expect(service.loginWithGoogle()).rejects.toBeInstanceOf(
        SessionExchangeError,
      );

      http.verify(); // no request was made at all
      expect(client.currentUser).toBeNull();
    });
  });

  describe('logout', () => {
    async function signIn(service: AuthService): Promise<void> {
      const http = TestBed.inject(HttpTestingController);
      const signedIn = service.loginWithGoogle();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush({});
      await signedIn;
    }

    /**
     * The acceptance criterion, stated as strictly as it can be: state is null
     * while the teardown request is still in flight, so nothing waits on the
     * network to stop showing a signed-in UI.
     */
    it('reflects sign-out on authState$ immediately, before the server responds', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      const seen = emitted(service);
      expect(seen.at(-1)).toMatchObject({ uid: 'google-uid' });

      const done = service.logout();
      await settle();

      expect(seen.at(-1)).toBeNull();
      expect(service.user()).toBeNull();

      const request = http.expectOne(SESSION_ENDPOINT);
      expect(request.request.method).toBe('DELETE');
      expect(request.request.withCredentials).toBe(true);
      request.flush(null);

      await done;
      http.verify();
    });

    it('emits null exactly once even though the SDK reports it too', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      const seen = emitted(service);
      const done = service.logout();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush(null);
      await done;

      expect(seen.filter((user) => user === null)).toHaveLength(1);
      http.verify();
    });

    /**
     * The server answers 200 `{ revoked: false }` when the cookie was already
     * expired, revoked or absent — it still clears it. That is a successful
     * sign-out, so there is deliberately no special case for it here: anything
     * that treated `revoked: false` as a failure would strand a user who is
     * already signed out in an error they cannot act on.
     */
    it('treats "there was nothing to revoke" as a successful sign-out', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      const done = service.logout();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush({ revoked: false });

      await expect(done).resolves.toBeUndefined();
      expect(service.user()).toBeNull();
      http.verify();
    });

    it('stays signed out locally when the server teardown fails, and says so', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      const done = service.logout();
      await settle();
      http
        .expectOne(SESSION_ENDPOINT)
        .flush({}, { status: 500, statusText: 'Server Error' });

      const error = await done.catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SessionExchangeError);
      // A failed revoke leaves the cookie in place server-side, so this one is
      // worth pressing again — unlike every 4xx.
      expect((error as SessionExchangeError).retryable).toBe(true);
      expect(service.user()).toBeNull();
      expect(client.currentUser).toBeNull();
      http.verify();
    });
  });

  describe('forgetSession', () => {
    async function signIn(service: AuthService): Promise<void> {
      const http = TestBed.inject(HttpTestingController);
      const signedIn = service.loginWithGoogle();
      await settle();
      http.expectOne(SESSION_ENDPOINT).flush({});
      await signedIn;
    }

    /**
     * The whole point of this method. `logout()` revokes the account's refresh
     * tokens for whatever session is valid when its DELETE lands — which is not
     * necessarily the session the 401 was about. Reaching the session route at
     * all from a recovery path is the bug.
     */
    it('drops local state without touching the session route', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      expect(service.user()).not.toBeNull();

      await service.forgetSession();

      expect(service.user()).toBeNull();
      expect(client.currentUser).toBeNull();
      expect(client.calls).toContain('signOut');
      // Nothing in flight, and nothing sent: the cookie is left to expire.
      http.verify();
    });

    it('still ends up signed out when the SDK sign-out fails', async () => {
      configure();
      const service = TestBed.inject(AuthService);
      const http = TestBed.inject(HttpTestingController);
      await signIn(service);

      client.signOutFailure = new Error('storage unavailable');

      await expect(service.forgetSession()).resolves.toBeUndefined();

      expect(service.user()).toBeNull();
      http.verify();
    });
  });

  describe('exchangeForSession', () => {
    it('refuses when nobody is signed in', async () => {
      configure();
      const service = TestBed.inject(AuthService);

      await expect(service.exchangeForSession()).rejects.toBeInstanceOf(
        AuthUnavailableError,
      );
      TestBed.inject(HttpTestingController).verify();
    });
  });

  describe('with no Firebase client', () => {
    /**
     * Server-side rendering, and a browser build with no `VITE_FIREBASE_*`
     * config. Neither may throw on construction, and neither may reach the
     * network.
     */
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: AUTH_CLIENT, useValue: null },
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
    });

    it('constructs, reports nobody, and refuses to sign in', async () => {
      const service = TestBed.inject(AuthService);

      expect(service.user()).toBeNull();
      await expect(service.currentUser()).resolves.toBeNull();
      await expect(service.loginWithGoogle()).rejects.toBeInstanceOf(
        AuthUnavailableError,
      );
      await expect(
        service.loginWithEmail('a@b.com', 'pw'),
      ).rejects.toBeInstanceOf(AuthUnavailableError);
      await expect(
        service.registerWithEmail('a@b.com', 'pw'),
      ).rejects.toBeInstanceOf(AuthUnavailableError);

      TestBed.inject(HttpTestingController).verify();
    });

    it('reports the missing config by name', async () => {
      const service = TestBed.inject(AuthService);
      const error = await service.loginWithGoogle().catch((e: unknown) => e);

      expect((error as Error).message).toContain('VITE_FIREBASE_API_KEY');
    });
  });

  describe('currentUser', () => {
    /**
     * On a hard refresh the SDK restores a persisted session asynchronously.
     * `currentUser()` must wait for that, or a guard built on it bounces a
     * signed-in user to the login page.
     */
    it('waits for Firebase to restore a persisted session', async () => {
      client.reporting = false;
      configure();
      const service = TestBed.inject(AuthService);

      const result: { user?: AuthUser | null } = {};
      const pending = service.currentUser().then((user) => {
        result.user = user;
      });

      await settle();
      expect('user' in result).toBe(false);

      // A persisted session exists, but Firebase has not said so yet.
      await client.signInWithEmail('restored@example.com', 'pw');
      await settle();
      expect('user' in result).toBe(false);

      client.beginReporting();

      await pending;
      expect(result.user?.uid).toBe('email-uid');
      TestBed.inject(HttpTestingController).verify();
    });
  });
});
