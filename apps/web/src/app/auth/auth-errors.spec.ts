import { describe, expect, it } from 'vitest';

import {
  SessionExchangeError,
  sessionRejectionReasonFrom,
  type SessionRejectionReason,
} from './auth-errors';

/**
 * The literal body Nitro serialises for a stale sign-in, copied from the server
 * agent's own report of the wire format. Note the top-level `error: true` —
 * Nitro's envelope flag, a boolean, sharing a name with the route's `data.error`
 * and meaning something entirely different.
 */
const NITRO_STALE_SIGN_IN = {
  error: true,
  url: 'https://host/api/v1/auth/session',
  statusCode: 401,
  statusMessage: 'Unauthorized',
  message: 'Sign in again.',
  data: { error: 'invalid-session', reason: 'stale-sign-in' },
};

/**
 * The parser runs on the failure path, where the body is whatever the server
 * (or a proxy, or an offline browser) happened to produce. Nothing here may
 * throw, and an unrecognised body must read as "no reason given" rather than as
 * a reason.
 */
describe('sessionRejectionReasonFrom', () => {
  const recognised: [string, unknown, string][] = [
    // The one that has to work. The rest are tolerance, not contract.
    ["Nitro's real envelope", NITRO_STALE_SIGN_IN, 'stale-sign-in'],
    [
      'a missing-cookie rejection',
      { data: { error: 'invalid-session', reason: 'missing' } },
      'missing',
    ],
    ['a bare reason', { reason: 'stale-sign-in' }, 'stale-sign-in'],
    ['a nested reason', { error: { reason: 'expired' } }, 'expired'],
    ['an error string', { error: 'revoked' }, 'revoked'],
  ];

  for (const [name, body, expected] of recognised) {
    it(`reads ${name}`, () => {
      expect(sessionRejectionReasonFrom(body)).toBe(expected);
    });
  }

  const unrecognised: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a plain string', 'Internal Server Error'],
    ['a proxy HTML page', '<html>502 Bad Gateway</html>'],
    ['an empty object', {}],
    ['a reason this client does not know', { reason: 'something-new' }],
    ['a Firebase error code', { error: { code: 'auth/whatever' } }],
    ['a network ProgressEvent', new ProgressEvent('error')],
    // 5xx is deliberately opaque server-side: no `data` at all. A bug on the
    // server must not read to this client as "bad credential, sign in again".
    [
      'an opaque 5xx',
      { error: true, statusCode: 500, message: 'Server Error' },
    ],
    // 400s name a code but never a `reason` — they are client bugs, not
    // verdicts on a credential.
    [
      'a 400 invalid-body',
      { statusCode: 400, data: { error: 'invalid-body' } },
    ],
  ];

  for (const [name, body] of unrecognised) {
    it(`gives no reason for ${name}`, () => {
      expect(sessionRejectionReasonFrom(body)).toBeUndefined();
    });
  }
});

/**
 * The retry rule exists to stop one specific bug: a login page treating
 * `stale-sign-in` as a transient failure and retrying forever against a token
 * whose `auth_time` a refresh cannot move.
 */
describe('SessionExchangeError.retryable', () => {
  const notRetryable: [string, number, SessionRejectionReason | undefined][] = [
    ['a stale sign-in', 401, 'stale-sign-in'],
    ['an expired credential', 401, 'expired'],
    ['a revoked credential', 401, 'revoked'],
    ['a disabled account', 401, 'disabled'],
    ['a malformed request body', 400, undefined],
    ['an account with no email claim', 400, undefined],
    ['a forbidden caller', 403, undefined],
    ['a missing user document', 404, undefined],
  ];

  for (const [name, status, reason] of notRetryable) {
    it(`does not invite a retry after ${name}`, () => {
      expect(
        new SessionExchangeError(status, reason, 'refused').retryable,
      ).toBe(false);
    });
  }

  const retryable: [string, number][] = [
    ['the request never reached the server', 0],
    ['the server errored opaquely', 500],
    ['the gateway was unavailable', 503],
  ];

  for (const [name, status] of retryable) {
    it(`invites a retry when ${name}`, () => {
      expect(
        new SessionExchangeError(status, undefined, 'failed').retryable,
      ).toBe(true);
    });
  }
});
