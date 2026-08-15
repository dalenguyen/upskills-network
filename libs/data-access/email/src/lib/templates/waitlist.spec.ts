import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../send';
import { renderWaitlistConfirmationEmail } from './waitlist';

/**
 * The landing-page waitlist confirmation, rendered against a real email
 * address. No client, no key, no network: the renderer is the half of the
 * template that produces the message.
 */

const EMAIL = 'Ada@Example.com';

/** The HTML and text parts, so one assertion covers both. */
function bodies(message: EmailMessage): string[] {
  return [message.html, message.text];
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('waitlist confirmation email', () => {
  it('is addressed to the subscriber and names the waitlist in the subject', () => {
    const message = renderWaitlistConfirmationEmail(EMAIL);

    expect(message.to).toBe(EMAIL);
    expect(message.subject).toBe("You're on the Upskills waitlist");
  });

  it('echoes the address and explains that early access is coming', () => {
    for (const body of bodies(renderWaitlistConfirmationEmail(EMAIL))) {
      expect(body).toContain(EMAIL);
      expect(body).toContain('early access');
      expect(body).toContain('waitlist');
      expect(body).toContain('spot opens up');
    }
  });

  it('links to the site home', () => {
    const message = renderWaitlistConfirmationEmail(EMAIL);

    expect(message.text).toContain('Visit Upskills: https://upskills.test');
    expect(message.html).toContain('href="https://upskills.test"');
  });

  it('produces a subject and both bodies with no undefined values', () => {
    const message = renderWaitlistConfirmationEmail(EMAIL);

    expect(message.subject).not.toBe('');
    expect(message.html).toContain('<table');
    for (const body of bodies(message)) {
      expect(body).not.toContain('undefined');
      expect(body).not.toContain('NaN');
    }
  });
});
