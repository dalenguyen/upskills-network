import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmailClient, setEmailClient, type EmailClient } from './client';
import { sendEmail, type EmailMessage } from './send';

/**
 * Issue #42 — the send path reports failure, it does not raise it.
 *
 * Every test here goes through a stub standing in for the Resend SDK, so nothing
 * in this file touches the network or needs an API key. The stub sits at the
 * same boundary the real client does — one `emails.send` call — which is the
 * last thing this library does, so everything it owns is still covered.
 *
 * The failure cases are the point. A 4xx, a 5xx, a rate limit and a dead socket
 * are four genuinely different situations for whoever has to decide whether to
 * retry, and all four must come back as values.
 */

const MESSAGE: EmailMessage = {
  to: 'guest@example.com',
  subject: 'You are registered',
  html: '<p>You are registered</p>',
  text: 'You are registered',
};

/** A stub whose single `send` does whatever the test tells it to. */
function clientThat(
  send: EmailClient['emails']['send'],
): EmailClient & { calls: Parameters<EmailClient['emails']['send']>[0][] } {
  const calls: Parameters<EmailClient['emails']['send']>[0][] = [];

  return {
    calls,
    emails: {
      send: (payload) => {
        calls.push(payload);
        return send(payload);
      },
    },
  };
}

/** The `{ data, error }` shape the SDK returns for a refused request. */
function resendError(statusCode: number | null, name: string, message: string) {
  return Promise.resolve({
    data: null,
    error: { statusCode, name, message },
    headers: null,
  } as Awaited<ReturnType<EmailClient['emails']['send']>>);
}

function resendOk(id: string) {
  return Promise.resolve({
    data: { id },
    error: null,
    headers: null,
  } as Awaited<ReturnType<EmailClient['emails']['send']>>);
}

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'rk_test_key');
  vi.stubEnv('EMAIL_FROM', 'Upskills <hello@upskills.test>');
  vi.stubEnv('EMAIL_REPLY_TO', '');
  // Failures are logged on purpose; silence them so a green run stays readable,
  // and so the assertions below can inspect what was logged.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setEmailClient(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendEmail', () => {
  it('reports the message id when Resend accepts it', async () => {
    setEmailClient(clientThat(() => resendOk('re_123')));

    expect(await sendEmail(MESSAGE)).toEqual({ sent: true, id: 're_123' });
  });

  it('sends the configured from address, both bodies, and the recipient', async () => {
    const client = clientThat(() => resendOk('re_123'));
    setEmailClient(client);

    await sendEmail(MESSAGE);

    expect(client.calls[0]).toMatchObject({
      from: 'Upskills <hello@upskills.test>',
      to: 'guest@example.com',
      subject: 'You are registered',
      html: '<p>You are registered</p>',
      text: 'You are registered',
    });
  });

  it('applies EMAIL_REPLY_TO so the "contact the organizer" copy has a route back', async () => {
    vi.stubEnv('EMAIL_REPLY_TO', 'support@upskills.test');
    const client = clientThat(() => resendOk('re_123'));
    setEmailClient(client);

    await sendEmail(MESSAGE);

    expect(client.calls[0]).toMatchObject({ replyTo: 'support@upskills.test' });
  });

  it('omits reply-to entirely when none is configured', async () => {
    const client = clientThat(() => resendOk('re_123'));
    setEmailClient(client);

    await sendEmail(MESSAGE);

    expect(client.calls[0]).not.toHaveProperty('replyTo');
  });
});

describe('sendEmail failure paths', () => {
  it('returns rejected — not a throw — on a 4xx from Resend', async () => {
    setEmailClient(
      clientThat(() =>
        resendError(422, 'validation_error', 'to must be a valid email address'),
      ),
    );

    const result = await sendEmail(MESSAGE);

    expect(result).toMatchObject({ sent: false, reason: 'rejected' });
    expect(result.sent === false && result.detail).toContain(
      'validation_error',
    );
  });

  it('returns unavailable — not a throw — on a 5xx from Resend', async () => {
    setEmailClient(
      clientThat(() =>
        resendError(500, 'internal_server_error', 'Something went wrong'),
      ),
    );

    expect(await sendEmail(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'unavailable',
    });
  });

  it('returns unavailable — not a throw — when the request never completes', async () => {
    setEmailClient(
      clientThat(() =>
        Promise.reject(new Error('getaddrinfo ENOTFOUND api.resend.com')),
      ),
    );

    const result = await sendEmail(MESSAGE);

    expect(result).toMatchObject({ sent: false, reason: 'unavailable' });
    expect(result.sent === false && result.detail).toContain('ENOTFOUND');
  });

  it('survives a non-Error thrown from the client', async () => {
    setEmailClient(clientThat(() => Promise.reject('socket hang up')));

    expect(await sendEmail(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'unavailable',
      detail: 'socket hang up',
    });
  });

  it('separates throttling from rejection so a retry is worth attempting', async () => {
    setEmailClient(
      clientThat(() =>
        resendError(429, 'rate_limit_exceeded', 'Too many requests'),
      ),
    );

    expect(await sendEmail(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'throttled',
    });
  });

  it('treats a quota error as throttling even without a status code', async () => {
    setEmailClient(
      clientThat(() =>
        resendError(null, 'daily_quota_exceeded', 'Daily quota reached'),
      ),
    );

    expect(await sendEmail(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'throttled',
    });
  });

  it('reports not_configured, and calls nothing, when there is no API key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const client = clientThat(() => resendOk('re_123'));
    // Deliberately not injected: this is the real "no key in this process" path.
    setEmailClient(null);

    const result = await sendEmail(MESSAGE);

    expect(result).toMatchObject({ sent: false, reason: 'not_configured' });
    expect(client.calls).toHaveLength(0);
  });

  it('rejects an empty recipient locally rather than asking Resend', async () => {
    const client = clientThat(() => resendOk('re_123'));
    setEmailClient(client);

    expect(await sendEmail({ ...MESSAGE, to: '  ' })).toMatchObject({
      sent: false,
      reason: 'rejected',
    });
    expect(client.calls).toHaveLength(0);
  });

  it('treats a response with neither id nor error as retryable', async () => {
    setEmailClient(
      clientThat(
        // Neither arm of the SDK's response union — deliberately a shape the
        // types say cannot happen, which is why it has to go through `unknown`.
        () =>
          Promise.resolve({
            data: null,
            error: null,
            headers: null,
          }) as unknown as ReturnType<EmailClient['emails']['send']>,
      ),
    );

    expect(await sendEmail(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'unavailable',
    });
  });

  it('logs enough to re-send by hand when a caller ignores the result', async () => {
    setEmailClient(
      clientThat(() => resendError(503, 'application_error', 'Upstream down')),
    );

    // The call site that forgets to check — the case the log exists for.
    void (await sendEmail(MESSAGE));

    expect(console.error).toHaveBeenCalledWith(
      '[email] send failed',
      expect.objectContaining({
        to: 'guest@example.com',
        subject: 'You are registered',
        reason: 'unavailable',
        detail: expect.stringContaining('Upstream down'),
      }),
    );
  });

  it('logs a missing key at warn, not error, so local runs do not cry wolf', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    setEmailClient(null);

    await sendEmail(MESSAGE);

    expect(console.warn).toHaveBeenCalledWith(
      '[email] not sent',
      expect.objectContaining({ reason: 'not_configured' }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('getEmailClient', () => {
  it('is null without a key, so importing this library never requires one', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    setEmailClient(null);

    expect(getEmailClient()).toBeNull();
  });

  it('builds the client from the environment at call time, and reuses it', () => {
    setEmailClient(null);

    const first = getEmailClient();
    expect(first).not.toBeNull();
    expect(getEmailClient()).toBe(first);
  });

  it('picks up a changed key instead of freezing the first one it saw', () => {
    setEmailClient(null);
    const first = getEmailClient();

    vi.stubEnv('RESEND_API_KEY', 'rk_test_rotated');

    expect(getEmailClient()).not.toBe(first);
  });
});
