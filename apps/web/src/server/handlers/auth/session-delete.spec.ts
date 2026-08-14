import type { AuthContext, MintedSession, SessionUser } from '@upskills/auth';
import { describe, expect, it, vi } from 'vitest';
import { fakeInvalidSessionError } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import {
  createSessionDeleteHandler,
  type SessionDeleteDeps,
} from './session-delete';

/**
 * `DELETE /api/v1/auth/session`.
 *
 * Both halves of sign-out are load-bearing and each is useless alone: clearing
 * without revoking leaves a stolen cookie working for five days, revoking
 * without clearing leaves the browser sending a dead one.
 */

const UID = 'uid-alice';

const CLEARED: Omit<MintedSession, 'expiresIn'> = {
  name: '__session',
  value: '',
  attributes: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  },
};

const CONTEXT: AuthContext = {
  uid: UID,
  role: 'user',
  session: {
    uid: UID,
    admin: false,
    expiresAt: new Date('2026-01-07T00:00:00.000Z'),
    claims: {} as unknown as SessionUser['claims'],
  },
};

function deps(overrides: Partial<SessionDeleteDeps> = {}): SessionDeleteDeps {
  return {
    requireAuth: vi.fn(async () => CONTEXT),
    revokeSessions: vi.fn(async () => undefined),
    clearedSessionCookie: vi.fn(() => CLEARED),
    ...overrides,
  };
}

function del() {
  return createTestEvent({
    method: 'DELETE',
    url: '/api/v1/auth/session',
    cookies: { __session: 'a-valid-cookie' },
  });
}

describe('DELETE /api/v1/auth/session', () => {
  it('revokes the refresh tokens and clears the cookie', async () => {
    const d = deps();
    const { event, setCookies } = del();

    const result = await createSessionDeleteHandler(d)(event);

    expect(d.revokeSessions).toHaveBeenCalledWith(UID);
    expect(result).toEqual({ revoked: true });

    // Cleared with the lib's own flags: a browser matches a deletion on name,
    // domain and path, so dropping `Path=/` would leave the cookie in place.
    const [cookie] = setCookies();
    expect(cookie).toContain('__session=;');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('still clears the cookie when the session was already invalid', async () => {
    // Answering 401 here would refuse to clear a dead cookie and leave the
    // client looping on a sign-out it can never complete.
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('expired');
      }),
    });
    const { event, setCookies } = del();

    const result = await createSessionDeleteHandler(d)(event);

    expect(result).toEqual({ revoked: false });
    expect(d.revokeSessions).not.toHaveBeenCalled();
    expect(setCookies()[0]).toContain('Max-Age=0');
  });

  it('treats a missing cookie as a completed sign-out', async () => {
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw fakeInvalidSessionError('missing');
      }),
    });

    const result = await createSessionDeleteHandler(d)(
      createTestEvent({ method: 'DELETE' }).event,
    );

    expect(result).toEqual({ revoked: false });
  });

  it('leaves the cookie in place when revocation fails', async () => {
    // Clearing here would report failure while quietly signing this browser
    // out, hiding that every other session is still live. Leaving it makes the
    // retry mean something.
    const d = deps({
      revokeSessions: vi.fn(async () => {
        throw new Error('firebase unavailable');
      }),
    });
    const { event, setCookies } = del();

    await expect(createSessionDeleteHandler(d)(event)).rejects.toThrow(
      'firebase unavailable',
    );
    expect(setCookies()).toEqual([]);
  });

  it('does not report a successful sign-out when the guard fails for an unknown reason', async () => {
    const bug = new TypeError('reads.getUser is not a function');
    const d = deps({
      requireAuth: vi.fn(async () => {
        throw bug;
      }),
    });
    const { event, setCookies } = del();

    await expect(createSessionDeleteHandler(d)(event)).rejects.toBe(bug);
    expect(d.revokeSessions).not.toHaveBeenCalled();
    expect(setCookies()).toEqual([]);
  });
});
