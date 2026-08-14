import type { MintedSession, SessionUser } from '@upskills/auth';
import type { User } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { fakeInvalidSessionError, fakeTimestamp } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { createSessionPostHandler, type SessionPostDeps } from './session-post';

/**
 * `POST /api/v1/auth/session`.
 *
 * The dependencies are injected because `@upskills/auth` cannot be imported at
 * runtime under Vitest (see `src/server/alias-smoke.spec.ts`); the lib's own
 * suite covers minting and verification, and what is left to check here is the
 * route's part: status mapping, the cookie it sets, and the order it does
 * things in.
 */

const UID = 'uid-alice';
const COOKIE_VALUE = 'minted.session.cookie';

const MINTED: MintedSession = {
  name: '__session',
  value: COOKIE_VALUE,
  expiresIn: 5 * 24 * 60 * 60 * 1000,
  attributes: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 5 * 24 * 60 * 60,
  },
};

const USER: User = {
  uid: UID,
  email: 'alice@example.com',
  role: 'user',
  orgIds: [],
  createdAt: fakeTimestamp(new Date('2026-01-02T03:04:05.000Z')),
};

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    uid: UID,
    email: 'alice@example.com',
    admin: false,
    expiresAt: new Date('2026-01-07T03:04:05.000Z'),
    // Only the claims these handlers read are worth spelling; the rest of
    // `DecodedIdToken` is Firebase's business.
    claims: { name: 'Alice' } as unknown as SessionUser['claims'],
    ...overrides,
  };
}

function deps(overrides: Partial<SessionPostDeps> = {}): SessionPostDeps {
  return {
    createSessionCookie: vi.fn(async () => MINTED),
    verifySessionCookie: vi.fn(async () => session()),
    upsertUser: vi.fn(async () => ({ user: USER, created: true })),
    ...overrides,
  };
}

function post(body: unknown) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/auth/session',
    body,
  });
}

describe('POST /api/v1/auth/session', () => {
  it('mints a cookie, creates the user document, and answers with the caller', async () => {
    const d = deps();
    const { event, setCookies } = post({ idToken: 'id-token' });

    const result = await createSessionPostHandler(d)(event);

    expect(d.createSessionCookie).toHaveBeenCalledWith('id-token');
    expect(d.upsertUser).toHaveBeenCalledWith({
      uid: UID,
      email: 'alice@example.com',
      name: 'Alice',
    });
    expect(result).toEqual({ uid: UID, role: 'user', created: true });

    // Name and flags are the lib's, not this route's.
    const [cookie] = setCookies();
    expect(cookie).toContain(`__session=${COOKIE_VALUE}`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=432000');
  });

  it('identifies the caller from the cookie it just minted', async () => {
    const d = deps();

    await createSessionPostHandler(d)(post({ idToken: 'id-token' }).event);

    expect(d.verifySessionCookie).toHaveBeenCalledWith(COOKIE_VALUE);
  });

  it('reports an existing user document as not created', async () => {
    const d = deps({
      upsertUser: vi.fn(async () => ({
        user: { ...USER, role: 'admin' as const },
        created: false,
      })),
    });

    const result = await createSessionPostHandler(d)(
      post({ idToken: 'id-token' }).event,
    );

    expect(result).toEqual({ uid: UID, role: 'admin', created: false });
  });

  it('answers 401 with a distinguishable reason when the sign-in is stale', async () => {
    // The five-minute window in `createSessionCookie`. A client that sees this
    // has to sign in again — retrying the exchange fails identically forever —
    // so the reason has to survive the trip.
    const d = deps({
      createSessionCookie: vi.fn(async () => {
        throw fakeInvalidSessionError('stale-sign-in');
      }),
    });
    const { event, setCookies } = post({ idToken: 'id-token' });

    await expect(createSessionPostHandler(d)(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'stale-sign-in' },
    });
    expect(setCookies()).toEqual([]);
    expect(d.upsertUser).not.toHaveBeenCalled();
  });

  it('distinguishes an expired token from a stale sign-in', async () => {
    const d = deps({
      createSessionCookie: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });

    await expect(
      createSessionPostHandler(d)(post({ idToken: 'id-token' }).event),
    ).rejects.toMatchObject({ statusCode: 401, data: { reason: 'expired' } });
  });

  it('answers 400 for a body that is not { idToken }', async () => {
    const d = deps();

    await expect(
      createSessionPostHandler(d)(post({ token: 'wrong-field' }).event),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-body' },
    });
    expect(d.createSessionCookie).not.toHaveBeenCalled();
  });

  it('answers 400 for an empty idToken without calling Firebase', async () => {
    const d = deps();

    await expect(
      createSessionPostHandler(d)(post({ idToken: '   ' }).event),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(d.createSessionCookie).not.toHaveBeenCalled();
  });

  it('answers 400 when the account carries no email address', async () => {
    const d = deps({
      verifySessionCookie: vi.fn(async () => session({ email: undefined })),
    });
    const { event, setCookies } = post({ idToken: 'id-token' });

    await expect(createSessionPostHandler(d)(event)).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'email-required' },
    });
    expect(setCookies()).toEqual([]);
  });

  it('omits the name when the token carries none', async () => {
    const d = deps({
      verifySessionCookie: vi.fn(async () =>
        session({ claims: {} as unknown as SessionUser['claims'] }),
      ),
    });

    await createSessionPostHandler(d)(post({ idToken: 'id-token' }).event);

    expect(d.upsertUser).toHaveBeenCalledWith({
      uid: UID,
      email: 'alice@example.com',
    });
  });

  it('lets an unrecognized failure stay a 500 instead of signing the user out', async () => {
    // The asymmetry `verifyOrReject` argues for: a bug here must not be
    // reported to the client as "your credential is bad, sign in again".
    const bug = new TypeError('auth client is undefined');
    const d = deps({
      createSessionCookie: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(
      createSessionPostHandler(d)(post({ idToken: 'id-token' }).event),
    ).rejects.toBe(bug);
  });

  it('does not set the cookie when the user document cannot be written', async () => {
    // A cookie set before the document exists leaves the browser signed in as
    // a user `me.get` cannot find.
    const d = deps({
      upsertUser: vi.fn(async () => {
        throw new Error('firestore unavailable');
      }),
    });
    const { event, setCookies } = post({ idToken: 'id-token' });

    await expect(createSessionPostHandler(d)(event)).rejects.toThrow(
      'firestore unavailable',
    );
    expect(setCookies()).toEqual([]);
  });
});
