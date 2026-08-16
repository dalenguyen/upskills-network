import { describe, expect, it } from 'vitest';

import { AuthUnavailableError, SessionExchangeError } from './auth-errors';
import { safeRedirectTarget, signInErrorMessage } from './sign-in-errors';

const GENERIC_CREDENTIAL_MESSAGE =
  "That email and password don't match an account.";

describe('signInErrorMessage', () => {
  const credentialFailures = [
    'auth/user-not-found',
    'auth/wrong-password',
    'auth/invalid-credential',
    'auth/invalid-email',
    'auth/user-disabled',
  ];

  for (const code of credentialFailures) {
    it(`maps ${code} to the single account-neutral message`, () => {
      const error = { code, message: `raw firebase detail for ${code}` };

      expect(signInErrorMessage(error)).toBe(GENERIC_CREDENTIAL_MESSAGE);
    });
  }

  const transientFailures = [
    'auth/network-request-failed',
    'auth/internal-error',
    'auth/timeout',
  ];

  for (const code of transientFailures) {
    it(`does not blame the credential for ${code}`, () => {
      // The credential was never judged, so saying it did not match would send
      // someone to reset a password that was correct all along.
      expect(signInErrorMessage({ code })).toBe(
        'Something went wrong. Try again.',
      );
    });
  }

  it('tells a rate-limited user to wait rather than to retry immediately', () => {
    expect(signInErrorMessage({ code: 'auth/too-many-requests' })).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
  });

  it('never reveals that an email is already registered', () => {
    const message = signInErrorMessage({
      code: 'auth/email-already-in-use',
      message: 'The email address is already in use by another account.',
    });

    expect(message).toBe(
      "We couldn't create that account. Try signing in instead.",
    );
  });

  it('can be specific about a weak password without describing the account', () => {
    expect(signInErrorMessage({ code: 'auth/weak-password' })).toBe(
      'That password is too weak. Use at least 6 characters.',
    );
  });

  const popupClosures = [
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
  ];

  for (const code of popupClosures) {
    it(`shows no error for ${code}`, () => {
      expect(signInErrorMessage({ code })).toBeNull();
    });
  }

  it('blames the browser, not the credential, for a blocked sign-in popup', () => {
    expect(signInErrorMessage({ code: 'auth/popup-blocked' })).toBe(
      'Sign-in window was blocked. Allow pop-ups for this site and try again.',
    );
  });

  it('reports an unavailable client as configuration, not a credential failure', () => {
    expect(
      signInErrorMessage(new AuthUnavailableError('missing Firebase config')),
    ).toBe('Sign-in is unavailable right now.');
  });

  it('invites a retry when the session exchange failed transiently', () => {
    expect(
      signInErrorMessage(new SessionExchangeError(0, undefined, 'failed')),
    ).toBe('Something went wrong. Try again.');
  });

  it('sends the user back through sign-in when the exchange was refused', () => {
    expect(
      signInErrorMessage(
        new SessionExchangeError(401, 'stale-sign-in', 'refused'),
      ),
    ).toBe('Please sign in again.');
  });

  it('uses the generic credential message for an unrecognised Firebase code', () => {
    const error = {
      code: 'auth/some-code-this-client-has-never-seen',
      message: 'raw firebase detail',
    };

    expect(signInErrorMessage(error)).toBe(GENERIC_CREDENTIAL_MESSAGE);
  });

  it('uses the generic credential message when no code can be read', () => {
    expect(signInErrorMessage(new Error('raw detail'))).toBe(
      GENERIC_CREDENTIAL_MESSAGE,
    );
    expect(signInErrorMessage('raw detail')).toBe(GENERIC_CREDENTIAL_MESSAGE);
    expect(signInErrorMessage({ message: 'raw detail' })).toBe(
      GENERIC_CREDENTIAL_MESSAGE,
    );
  });
});

describe('safeRedirectTarget', () => {
  it('keeps a same-origin relative path', () => {
    expect(safeRedirectTarget('/dashboard/events')).toBe('/dashboard/events');
  });

  it('defaults to / when no redirectTo was supplied', () => {
    expect(safeRedirectTarget(null)).toBe('/');
    expect(safeRedirectTarget('')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeRedirectTarget('//evil.example.com')).toBe('/');
  });

  it('rejects a backslash protocol-relative URL', () => {
    expect(safeRedirectTarget('/\\evil.example.com')).toBe('/');
  });

  it('rejects an absolute URL', () => {
    expect(safeRedirectTarget('https://evil.example.com')).toBe('/');
  });

  it('rejects a javascript: URL', () => {
    expect(safeRedirectTarget('javascript:alert(1)')).toBe('/');
  });
});
