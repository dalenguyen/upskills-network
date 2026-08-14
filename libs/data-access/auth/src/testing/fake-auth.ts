import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CustomClaims } from '../lib/admin-claim';

/**
 * A fake Firebase Auth client for this library's tests.
 *
 * ## Why a fake and not the emulator
 *
 * Session cookies and custom claims are Auth operations, and this workspace
 * runs only the Firestore emulator — the harness in `@upskills/firestore` can
 * do nothing for them. Rather than mock the Admin SDK's internals (which tests
 * the mock, and breaks whenever the SDK reshuffles a private method), every
 * function in this library takes its `auth` client as an argument and this
 * stands in for it. The code under test is then byte-for-byte the code that
 * runs in production; only the client differs.
 *
 * ## Why it models revocation and expiry rather than just recording calls
 *
 * The interesting behavior of this library is *conditional*: what happens when
 * a cookie is expired versus revoked versus garbage, and whether a revocation
 * actually invalidates a cookie already in the wild. A spy that always resolves
 * cannot express any of that. So this fake keeps the small amount of state
 * Firebase keeps — a `tokensValidAfterMs` per account, an issue and expiry time
 * per credential — and enforces the same rules, including the one that matters
 * most: revocation is only honored when `checkRevoked` is passed.
 *
 * The obvious limit: it is a model of Firebase, not Firebase. It proves this
 * library asks for the right things and reacts correctly to the answers; it
 * cannot prove Firebase behaves as documented.
 */

/** A Firebase-shaped error: what the Admin SDK throws, as far as we read it. */
export class FakeAuthError extends Error {
  constructor(readonly code: string) {
    super(`fake auth error: ${code}`);
    this.name = 'FirebaseAuthError';
  }
}

interface FakeAccount {
  customClaims: CustomClaims;
  disabled: boolean;
  /** Mirrors Firebase's `tokensValidAfterTime`; 0 means never revoked. */
  tokensValidAfterMs: number;
}

interface FakeCredential {
  uid: string;
  /** Issued-at, in ms. */
  issuedAtMs: number;
  /** Expiry, in ms. */
  expiresAtMs: number;
  email?: string;
  claims: CustomClaims;
}

export interface SeedIdTokenOptions {
  uid?: string;
  email?: string;
  /** When the user actually signed in. Defaults to now. */
  authTimeMs?: number;
  /** When the token was issued. Defaults to `authTimeMs`. */
  issuedAtMs?: number;
  /** When the token expires. Defaults to an hour after issue. */
  expiresAtMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class FakeAuth {
  /** Overridable clock, so expiry can be tested without waiting for it. */
  now: () => number = () => Date.now();

  /** Method names in call order — the seam for asserting on ordering. */
  readonly calls: string[] = [];

  private readonly accounts = new Map<string, FakeAccount>();
  private readonly idTokens = new Map<
    string,
    FakeCredential & { authTimeMs: number }
  >();
  private readonly cookies = new Map<string, FakeCredential>();
  private minted = 0;

  /** Create (or fetch) an account, so claims can be asserted on. */
  account(uid: string): FakeAccount {
    let account = this.accounts.get(uid);
    if (!account) {
      account = { customClaims: {}, disabled: false, tokensValidAfterMs: 0 };
      this.accounts.set(uid, account);
    }

    return account;
  }

  /** Register an ID token this fake will accept, and return its value. */
  seedIdToken(token: string, options: SeedIdTokenOptions = {}): string {
    const uid = options.uid ?? 'uid-1';
    const authTimeMs = options.authTimeMs ?? this.now();
    const issuedAtMs = options.issuedAtMs ?? authTimeMs;

    this.account(uid);
    this.idTokens.set(token, {
      uid,
      authTimeMs,
      issuedAtMs,
      expiresAtMs: options.expiresAtMs ?? issuedAtMs + HOUR_MS,
      ...(options.email === undefined ? {} : { email: options.email }),
      claims: {},
    });

    return token;
  }

  async verifyIdToken(
    idToken: string,
    checkRevoked?: boolean,
  ): Promise<DecodedIdToken> {
    this.calls.push('verifyIdToken');
    const token = this.idTokens.get(idToken);
    if (!token) {
      throw new FakeAuthError('auth/argument-error');
    }

    this.assertUsable(token, 'id-token', checkRevoked === true);

    return decodedToken({
      uid: token.uid,
      authTimeMs: token.authTimeMs,
      issuedAtMs: token.issuedAtMs,
      expiresAtMs: token.expiresAtMs,
      ...(token.email === undefined ? {} : { email: token.email }),
      claims: this.account(token.uid).customClaims,
    });
  }

  async createSessionCookie(
    idToken: string,
    sessionCookieOptions: { expiresIn: number },
  ): Promise<string> {
    this.calls.push('createSessionCookie');
    const token = this.idTokens.get(idToken);
    if (!token) {
      throw new FakeAuthError('auth/argument-error');
    }

    const value = `cookie-${++this.minted}`;
    const issuedAtMs = this.now();
    this.cookies.set(value, {
      uid: token.uid,
      issuedAtMs,
      expiresAtMs: issuedAtMs + sessionCookieOptions.expiresIn,
      ...(token.email === undefined ? {} : { email: token.email }),
      // Claims are snapshotted at mint time, exactly as Firebase does it.
      claims: { ...this.account(token.uid).customClaims },
    });

    return value;
  }

  async verifySessionCookie(
    sessionCookie: string,
    checkRevoked?: boolean,
  ): Promise<DecodedIdToken> {
    this.calls.push('verifySessionCookie');
    const cookie = this.cookies.get(sessionCookie);
    if (!cookie) {
      throw new FakeAuthError('auth/argument-error');
    }

    this.assertUsable(cookie, 'session-cookie', checkRevoked === true);

    return decodedToken({
      uid: cookie.uid,
      authTimeMs: cookie.issuedAtMs,
      issuedAtMs: cookie.issuedAtMs,
      expiresAtMs: cookie.expiresAtMs,
      ...(cookie.email === undefined ? {} : { email: cookie.email }),
      claims: cookie.claims,
    });
  }

  async getUser(uid: string): Promise<{ customClaims?: CustomClaims }> {
    this.calls.push('getUser');
    const account = this.accounts.get(uid);
    if (!account) {
      throw new FakeAuthError('auth/user-not-found');
    }

    return { customClaims: { ...account.customClaims } };
  }

  async setCustomUserClaims(
    uid: string,
    customUserClaims: object | null,
  ): Promise<void> {
    this.calls.push('setCustomUserClaims');
    // Firebase replaces the whole claim object; `null` clears it. Modelling the
    // replacement is the point — it is what makes a non-merging caller fail.
    this.account(uid).customClaims = {
      ...((customUserClaims ?? {}) as CustomClaims),
    };
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    this.calls.push('revokeRefreshTokens');
    // Firebase records this truncated to the second; the same truncation is
    // modelled here so a cookie minted in the same second survives, as it does
    // in production.
    this.account(uid).tokensValidAfterMs = Math.floor(this.now() / 1000) * 1000;
  }

  private assertUsable(
    credential: FakeCredential,
    kind: 'id-token' | 'session-cookie',
    checkRevoked: boolean,
  ): void {
    if (this.now() >= credential.expiresAtMs) {
      throw new FakeAuthError(`auth/${kind}-expired`);
    }

    const account = this.account(credential.uid);
    if (account.disabled) {
      throw new FakeAuthError('auth/user-disabled');
    }

    // Only when asked: a verification without `checkRevoked` is offline and
    // cannot see a revocation, which is the whole reason this library always
    // passes `true`.
    if (checkRevoked && credential.issuedAtMs < account.tokensValidAfterMs) {
      throw new FakeAuthError(`auth/${kind}-revoked`);
    }
  }
}

function decodedToken(input: {
  uid: string;
  authTimeMs: number;
  issuedAtMs: number;
  expiresAtMs: number;
  email?: string;
  claims: CustomClaims;
}): DecodedIdToken {
  return {
    ...input.claims,
    aud: 'demo-upskills',
    auth_time: Math.floor(input.authTimeMs / 1000),
    exp: Math.floor(input.expiresAtMs / 1000),
    iat: Math.floor(input.issuedAtMs / 1000),
    iss: 'https://securetoken.google.com/demo-upskills',
    sub: input.uid,
    uid: input.uid,
    ...(input.email === undefined ? {} : { email: input.email }),
    firebase: { identities: {}, sign_in_provider: 'password' },
  };
}
