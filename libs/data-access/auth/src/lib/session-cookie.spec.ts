import type { Auth } from 'firebase-admin/auth';
import { FakeAuth, FakeAuthError } from '../testing/fake-auth';
import {
  DEFAULT_SESSION_LIFETIME_MS,
  InvalidSessionError,
  MAX_SESSION_LIFETIME_MS,
  MIN_SESSION_LIFETIME_MS,
  SESSION_COOKIE_NAME,
  clampSessionLifetime,
  clearedSessionCookie,
  createSessionCookie,
  revokeSessions,
  verifySessionCookie,
  type MintingAuth,
  type RevokingAuth,
  type VerifyingAuth,
} from './session-cookie';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The seams must stay honest: a real `Auth` has to satisfy them, or the tests
 * below would be exercising a shape production never passes. Compile-time only.
 */
it('accepts the real Admin SDK client through every seam', () => {
  const auth = {} as Auth;
  const minting: MintingAuth = auth;
  const verifying: VerifyingAuth = auth;
  const revoking: RevokingAuth = auth;

  expect([minting, verifying, revoking]).toHaveLength(3);
});

describe('clampSessionLifetime', () => {
  it('defaults to five days', () => {
    expect(clampSessionLifetime()).toBe(DEFAULT_SESSION_LIFETIME_MS);
    expect(DEFAULT_SESSION_LIFETIME_MS).toBe(5 * 24 * HOUR);
  });

  it('raises a lifetime below the Firebase floor', () => {
    expect(clampSessionLifetime(1000)).toBe(MIN_SESSION_LIFETIME_MS);
    expect(clampSessionLifetime(0)).toBe(MIN_SESSION_LIFETIME_MS);
    expect(clampSessionLifetime(-1 * HOUR)).toBe(MIN_SESSION_LIFETIME_MS);
  });

  it('lowers a lifetime above the Firebase ceiling', () => {
    expect(clampSessionLifetime(30 * 24 * HOUR)).toBe(MAX_SESSION_LIFETIME_MS);
  });

  it('passes an in-range lifetime through untouched', () => {
    expect(clampSessionLifetime(2 * 24 * HOUR)).toBe(2 * 24 * HOUR);
  });

  it('falls back to the default for a non-finite lifetime', () => {
    // What `Number(process.env.SESSION_TTL_MS)` yields when the var is unset.
    expect(clampSessionLifetime(Number.NaN)).toBe(DEFAULT_SESSION_LIFETIME_MS);
    expect(clampSessionLifetime(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SESSION_LIFETIME_MS,
    );
  });
});

describe('createSessionCookie', () => {
  it('mints a __session cookie with all four flags', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', { uid: 'uid-1', email: 'a@b.com' });

    const session = await createSessionCookie('token', { auth });

    expect(session.name).toBe(SESSION_COOKIE_NAME);
    expect(session.name).toBe('__session');
    expect(session.attributes).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 24 * 60 * 60,
    });
  });

  it('expresses maxAge in seconds while Firebase counts milliseconds', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token');

    const session = await createSessionCookie('token', {
      auth,
      expiresIn: 2 * HOUR,
    });

    expect(session.expiresIn).toBe(2 * HOUR);
    expect(session.attributes.maxAge).toBe(2 * 60 * 60);
  });

  it('mints with the clamped lifetime, not the one asked for', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token');

    const session = await createSessionCookie('token', {
      auth,
      expiresIn: 30 * 24 * HOUR,
    });

    expect(session.expiresIn).toBe(MAX_SESSION_LIFETIME_MS);

    // The cookie really carries the clamped life, not just the reported one.
    auth.now = () => Date.now() + MAX_SESSION_LIFETIME_MS + 1000;
    await expect(
      verifySessionCookie(session.value, { auth }),
    ).rejects.toMatchObject({ reason: 'expired' });
  });

  it('checks revocation while verifying the ID token', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', { uid: 'uid-1' });

    // A second later, so the revocation stamp (truncated to the second, as
    // Firebase truncates it) lands strictly after the token was issued.
    auth.now = () => Date.now() + 1000;
    await revokeSessions('uid-1', { auth });

    // The token predates the revocation, so it may not become a five-day
    // session. Without `checkRevoked` on the mint path this would succeed.
    await expect(createSessionCookie('token', { auth })).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    expect(auth.calls).not.toContain('createSessionCookie');
  });

  it('refuses to upgrade a stale sign-in into a session', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', {
      // Signed in an hour ago, token refreshed since — `auth_time` does not
      // move on refresh, which is exactly what makes the check meaningful.
      authTimeMs: Date.now() - HOUR,
      issuedAtMs: Date.now(),
    });

    await expect(createSessionCookie('token', { auth })).rejects.toMatchObject({
      reason: 'stale-sign-in',
      status: 401,
    });
    expect(auth.calls).not.toContain('createSessionCookie');
  });

  it('accepts a stale sign-in when the check is disabled', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', {
      authTimeMs: Date.now() - HOUR,
      issuedAtMs: Date.now(),
    });

    const session = await createSessionCookie('token', {
      auth,
      maxAuthAgeMs: 0,
    });

    expect(session.value).not.toBe('');
  });

  it('rejects an empty or unknown ID token as a 401', async () => {
    const auth = new FakeAuth();

    await expect(createSessionCookie('', { auth })).rejects.toMatchObject({
      reason: 'malformed',
      status: 401,
    });
    await expect(
      createSessionCookie('not-a-token', { auth }),
    ).rejects.toMatchObject({ reason: 'malformed', status: 401 });
  });

  it('rethrows an unlabeled failure from either Firebase call', async () => {
    const bug = new TypeError('cannot read properties of undefined');

    // A genuine decoded token, so the second case reaches the mint call.
    const real = new FakeAuth();
    real.seedIdToken('token');
    const decoded = await real.verifyIdToken('token');

    const failsVerifying: MintingAuth = {
      verifyIdToken: () => Promise.reject(bug),
      createSessionCookie: () => Promise.resolve('never-reached'),
    };
    await expect(
      createSessionCookie('token', { auth: failsVerifying }),
    ).rejects.toBe(bug);

    const failsMinting: MintingAuth = {
      verifyIdToken: () => Promise.resolve(decoded),
      createSessionCookie: () => Promise.reject(bug),
    };
    await expect(
      createSessionCookie('token', { auth: failsMinting }),
    ).rejects.toBe(bug);
  });

  it('snapshots the claims that were current at mint time', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', { uid: 'uid-1' });
    auth.account('uid-1').customClaims = { admin: true };

    const session = await createSessionCookie('token', { auth });

    await expect(
      verifySessionCookie(session.value, { auth }),
    ).resolves.toMatchObject({ admin: true });
  });
});

describe('verifySessionCookie', () => {
  async function mint(auth: FakeAuth, uid = 'uid-1'): Promise<string> {
    auth.seedIdToken(`token-${uid}`, { uid, email: `${uid}@example.com` });
    return (await createSessionCookie(`token-${uid}`, { auth })).value;
  }

  it('answers who the caller is', async () => {
    const auth = new FakeAuth();
    const cookie = await mint(auth);

    const user = await verifySessionCookie(cookie, { auth });

    expect(user.uid).toBe('uid-1');
    expect(user.email).toBe('uid-1@example.com');
    expect(user.admin).toBe(false);
    expect(user.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(user.claims.uid).toBe('uid-1');
  });

  it('rejects a missing cookie without calling Firebase', async () => {
    const auth = new FakeAuth();

    for (const absent of [undefined, null, '', '   ']) {
      await expect(verifySessionCookie(absent, { auth })).rejects.toMatchObject(
        { reason: 'missing', status: 401 },
      );
    }

    expect(auth.calls).toEqual([]);
  });

  it('rejects a malformed cookie as a 401, not a crash', async () => {
    const auth = new FakeAuth();

    const error = await verifySessionCookie('garbage', { auth }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(InvalidSessionError);
    expect(error).toMatchObject({ reason: 'malformed', status: 401 });
  });

  it('rejects an expired cookie as a 401, not a 500', async () => {
    const auth = new FakeAuth();
    const cookie = await mint(auth);

    auth.now = () => Date.now() + DEFAULT_SESSION_LIFETIME_MS + 1000;

    const error = await verifySessionCookie(cookie, { auth }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(InvalidSessionError);
    expect(error).toMatchObject({ reason: 'expired', status: 401 });
  });

  it('rejects a cookie whose account has been disabled', async () => {
    const auth = new FakeAuth();
    const cookie = await mint(auth);
    auth.account('uid-1').disabled = true;

    await expect(verifySessionCookie(cookie, { auth })).rejects.toMatchObject({
      reason: 'disabled',
      status: 401,
    });
  });

  it('rethrows an Auth outage instead of signing everyone out', async () => {
    const outage = new FakeAuthError('auth/internal-error');
    const auth: VerifyingAuth = {
      verifySessionCookie: () => Promise.reject(outage),
    };

    const error = await verifySessionCookie('cookie', { auth }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(outage);
    expect(error).not.toBeInstanceOf(InvalidSessionError);
  });

  // The likeliest bugs arrive with no `code` at all: a TypeError from this
  // module, an injected client that is undefined, a socket error. None of them
  // is a statement about the user's credential, and turning them into 401s
  // would sign everybody out over a bug nobody would ever be paged for.
  it('rethrows an unlabeled failure rather than blaming the credential', async () => {
    const bug = new TypeError('auth.verifySessionCookie is not a function');
    const auth: VerifyingAuth = {
      verifySessionCookie: () => Promise.reject(bug),
    };

    const error = await verifySessionCookie('cookie', { auth }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(bug);
    expect(error).not.toBeInstanceOf(InvalidSessionError);
  });

  it('rethrows an unrecognized auth/* code so the gap is visible', async () => {
    const unknown = new FakeAuthError('auth/some-code-added-in-2027');
    const auth: VerifyingAuth = {
      verifySessionCookie: () => Promise.reject(unknown),
    };

    await expect(verifySessionCookie('cookie', { auth })).rejects.toBe(unknown);
  });

  it('always asks Firebase to check revocation', async () => {
    let checkRevoked: boolean | undefined;
    const auth: VerifyingAuth = {
      verifySessionCookie: (_cookie, revoked) => {
        checkRevoked = revoked;
        return Promise.reject(new FakeAuthError('auth/argument-error'));
      },
    };

    await verifySessionCookie('cookie', { auth }).catch(() => undefined);

    expect(checkRevoked).toBe(true);
  });
});

describe('revokeSessions', () => {
  it('invalidates a cookie that was already in the wild', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token', { uid: 'uid-1' });
    const { value: cookie } = await createSessionCookie('token', { auth });

    await expect(verifySessionCookie(cookie, { auth })).resolves.toMatchObject({
      uid: 'uid-1',
    });

    // A second past the mint, so the revocation timestamp (which Firebase
    // truncates to the second) lands strictly after the cookie was issued.
    auth.now = () => Date.now() + 1000;
    await revokeSessions('uid-1', { auth });

    await expect(verifySessionCookie(cookie, { auth })).rejects.toMatchObject({
      reason: 'revoked',
      status: 401,
    });
  });

  it('leaves every other account signed in', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token-1', { uid: 'uid-1' });
    auth.seedIdToken('token-2', { uid: 'uid-2' });
    const first = await createSessionCookie('token-1', { auth });
    const second = await createSessionCookie('token-2', { auth });

    auth.now = () => Date.now() + 1000;
    await revokeSessions('uid-1', { auth });

    await expect(
      verifySessionCookie(first.value, { auth }),
    ).rejects.toMatchObject({ reason: 'revoked' });
    await expect(
      verifySessionCookie(second.value, { auth }),
    ).resolves.toMatchObject({ uid: 'uid-2' });
  });
});

describe('clearedSessionCookie', () => {
  it('repeats the flags so the browser matches the cookie it is deleting', async () => {
    const auth = new FakeAuth();
    auth.seedIdToken('token');
    const minted = await createSessionCookie('token', { auth });
    const cleared = clearedSessionCookie();

    expect(cleared.name).toBe(minted.name);
    expect(cleared.value).toBe('');
    expect(cleared.attributes).toEqual({
      ...minted.attributes,
      maxAge: 0,
    });
  });
});
