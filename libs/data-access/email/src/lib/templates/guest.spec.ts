import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventFixture,
  guestFixture,
  paidEventFixture,
  paidGuestFixture,
} from '../../testing/fixtures';
import { cancelUrl } from '../format';
import type { EmailMessage } from '../send';
import {
  renderCancellationEmail,
  renderPaymentReceiptEmail,
  renderSoldOutRefundEmail,
  renderSpotOpenedEmail,
  renderWaitlistEmail,
  renderWelcomeEmail,
} from './guest';

/**
 * Issue #43 — the six guest emails, rendered against real model fixtures.
 *
 * No client, no key, no network: every test here calls a `render…`, which is the
 * half of each template that produces the message. That is what lets the copy be
 * verified now, months before the sending domain is verified and anything can
 * actually be delivered to a guest.
 *
 * Assertions run against **both** bodies through {@link bodies}. A cancel link
 * that made it into the HTML and not the text would pass a naive test and still
 * strand every guest whose client shows plain text.
 */

/** The HTML and text parts, so one assertion covers both. */
function bodies(message: EmailMessage): string[] {
  return [message.html, message.text];
}

/** Every rendered body, with HTML entities decoded back to their characters. */
function readable(message: EmailMessage): string[] {
  return bodies(message).map((body) =>
    body
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"'),
  );
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('welcome email', () => {
  it('is addressed to the guest and names the event in the subject', () => {
    const message = renderWelcomeEmail(
      guestFixture(),
      eventFixture(),
      'upskills',
    );

    expect(message.to).toBe('Priya.Raman@example.com');
    expect(message.subject).toBe(
      "You're registered for TypeScript for Working Developers",
    );
  });

  it('greets the guest by their first name', () => {
    for (const body of bodies(
      renderWelcomeEmail(guestFixture(), eventFixture(), 'upskills'),
    )) {
      expect(body).toContain('Priya');
    }
  });

  it('states the time in the event zone and the place', () => {
    for (const body of bodies(
      renderWelcomeEmail(guestFixture(), eventFixture(), 'upskills'),
    )) {
      expect(body).toContain('Thursday, September 3, 2026 at 6:30 p.m. EDT');
      expect(body).toContain('Ada Room, 250 University Ave, Toronto');
    }
  });

  it('carries this guest’s cancel link in both bodies', () => {
    const guest = guestFixture();
    const message = renderWelcomeEmail(guest, eventFixture(), 'upskills');
    const link = cancelUrl(guest);

    expect(message.text).toContain(link);
    // The HTML escapes the ampersands between query parameters.
    expect(message.html).toContain(link.replace(/&/g, '&amp;'));
    expect(link).toContain('token=H1nQ8wZ3rTgKpLm2vXbA9fJd');
  });

  it('shows what a paid guest was charged, and warns that cancelling refunds nothing', () => {
    const message = renderWelcomeEmail(
      paidGuestFixture(),
      paidEventFixture(),
      'upskills',
    );

    for (const body of readable(message)) {
      expect(body).toContain('$25.00 CAD');
      expect(body).toContain('does not refund your payment');
    }
  });

  it('does not mention refunds to someone who paid nothing', () => {
    for (const body of readable(
      renderWelcomeEmail(guestFixture(), eventFixture(), 'upskills'),
    )) {
      expect(body).not.toContain('refund');
      expect(body).toContain('Free');
    }
  });
});

describe('waitlist email', () => {
  const message = () =>
    renderWaitlistEmail(
      guestFixture({ status: 'pending', waitlistPosition: 4 }),
      eventFixture(),
      4,
      'upskills',
    );

  it('says waitlist in the subject, not registered', () => {
    expect(message().subject).toBe(
      "You're on the waitlist for TypeScript for Working Developers",
    );
  });

  it('never claims a confirmed seat', () => {
    for (const body of readable(message())) {
      expect(body).toContain('This is not a spot at the event');
      expect(body).not.toMatch(/\bconfirmed\b/i);
      expect(body).not.toMatch(/you'?re in\b/i);
      expect(body).not.toMatch(/\byour spot is\b/i);
    }
  });

  it('gives the position it was passed, not the one on the stale guest doc', () => {
    const stale = guestFixture({ status: 'pending', waitlistPosition: 99 });
    const rendered = renderWaitlistEmail(stale, eventFixture(), 4, 'upskills');

    for (const body of readable(rendered)) {
      expect(body).toContain('number 4');
      expect(body).not.toContain('99');
    }
  });

  it('still offers a way off the waitlist', () => {
    expect(message().text).toContain(
      cancelUrl(guestFixture({ status: 'pending' })),
    );
  });
});

describe('spot opened email', () => {
  it('says the spot is confirmed and offers to release it again', () => {
    const guest = guestFixture();
    const message = renderSpotOpenedEmail(guest, eventFixture(), 'upskills');

    for (const body of readable(message)) {
      expect(body).toContain('confirmed');
      expect(body).toContain('Thursday, September 3, 2026 at 6:30 p.m. EDT');
    }
    expect(message.text).toContain(cancelUrl(guest));
  });
});

describe('cancellation email', () => {
  it('states plainly that a payment is not refunded, with the amount', () => {
    const message = renderCancellationEmail(
      paidGuestFixture({ status: 'cancelled' }),
      paidEventFixture(),
      'upskills',
    );

    for (const body of readable(message)) {
      expect(body).toContain('$25.00 CAD');
      expect(body).toContain('has not been refunded');
      expect(body).toContain("organizer's discretion");
    }
  });

  it('still says it when the guest doc carries no payment but the event has a price', () => {
    // A cancellation arriving before the webhook wrote `amountPaid` must not
    // silently drop the policy the guest most needs to read.
    const message = renderCancellationEmail(
      guestFixture({ status: 'cancelled' }),
      paidEventFixture(),
      'upskills',
    );

    for (const body of readable(message)) {
      expect(body).toContain('has not been refunded');
    }
  });

  it('says nothing about refunds for a free registration', () => {
    const message = renderCancellationEmail(
      guestFixture({ status: 'cancelled' }),
      eventFixture(),
      'upskills',
    );

    for (const body of readable(message)) {
      expect(body).not.toContain('refund');
      expect(body).toContain('spot has been released');
    }
  });

  it('offers no cancel link, because there is nothing left to cancel', () => {
    const guest = guestFixture({ status: 'cancelled' });
    const message = renderCancellationEmail(guest, eventFixture(), 'upskills');

    for (const body of bodies(message)) {
      expect(body).not.toContain('/r/cancel');
      expect(body).not.toContain(guest.cancelToken);
    }
  });
});

describe('payment receipt email', () => {
  it('reports the amount, the payer, and the Stripe reference', () => {
    const message = renderPaymentReceiptEmail(
      paidGuestFixture(),
      paidEventFixture(),
      'upskills',
    );

    expect(message.subject).toBe(
      'Receipt for TypeScript for Working Developers',
    );
    for (const body of readable(message)) {
      expect(body).toContain('$25.00 CAD');
      expect(body).toContain('Priya.Raman@example.com');
      expect(body).toContain('pi_3QxYz1AbCdEf');
    }
  });

  it('falls back to the checkout session when no payment intent was recorded', () => {
    const guest = paidGuestFixture({ stripePaymentIntentId: undefined });

    for (const body of readable(
      renderPaymentReceiptEmail(guest, paidEventFixture(), 'upskills'),
    )) {
      expect(body).toContain('cs_test_a1b2c3');
    }
  });

  it('carries the cancel link and the no-refund policy', () => {
    const guest = paidGuestFixture();
    const message = renderPaymentReceiptEmail(
      guest,
      paidEventFixture(),
      'upskills',
    );

    expect(message.text).toContain(cancelUrl(guest));
    for (const body of readable(message)) {
      expect(body).toContain('does not refund your payment');
    }
  });
});

describe('sold out refund email', () => {
  const message = () =>
    renderSoldOutRefundEmail(
      paidGuestFixture({ status: 'expired' }),
      paidEventFixture({ confirmedCount: 30 }),
      'upskills',
    );

  it('says the guest is not registered and the money is coming back', () => {
    expect(message().subject).toContain('sold out');

    for (const body of readable(message())) {
      expect(body).toContain('You are not registered for this event');
      expect(body).toContain('refunded $25.00 CAD in full');
    }
  });

  it('offers no cancel link, because there is no registration', () => {
    for (const body of bodies(message())) {
      expect(body).not.toContain('/r/cancel');
    }
  });
});

describe('every guest template', () => {
  const guest = paidGuestFixture();
  const event = paidEventFixture();

  // Built inside each test rather than in the describe body: a describe body
  // runs at collection time, before `beforeEach` has stubbed `SITE_URL`, so
  // messages rendered there would carry the fallback origin.
  const renderAll = (): EmailMessage[] => [
    renderWelcomeEmail(guest, event, 'upskills'),
    renderWaitlistEmail(guest, event, 2, 'upskills'),
    renderSpotOpenedEmail(guest, event, 'upskills'),
    renderCancellationEmail(guest, event, 'upskills'),
    renderPaymentReceiptEmail(guest, event, 'upskills'),
    renderSoldOutRefundEmail(guest, event, 'upskills'),
  ];

  it('produces a subject and both bodies', () => {
    for (const message of renderAll()) {
      expect(message.subject).not.toBe('');
      expect(message.html).toContain('<table');
      expect(message.text.trim()).not.toBe('');
    }
  });

  it('never leaves an undefined or NaN in the output', () => {
    for (const message of renderAll()) {
      for (const body of bodies(message)) {
        expect(body).not.toContain('undefined');
        expect(body).not.toContain('NaN');
        expect(body).not.toContain('[object Object]');
      }
    }
  });

  it('renders without network access — no remote assets to fetch', () => {
    for (const message of renderAll()) {
      expect(message.html).not.toMatch(/<img/i);
      expect(message.html).not.toMatch(/<link/i);
      expect(message.html).not.toMatch(/<script/i);
      // Every href is our own site; nothing else is loaded to display the mail.
      for (const [, href] of message.html.matchAll(/href="([^"]+)"/g)) {
        expect(href).toContain('upskills.test');
      }
    }
  });

  it('escapes free text a guest typed rather than rendering it as markup', () => {
    const hostile = guestFixture({
      name: '<script>alert(1)</script> Priya',
    });

    const message = renderWelcomeEmail(hostile, event, 'upskills');

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('escapes an event title that contains markup', () => {
    const hostile = paidEventFixture({ title: 'Angular <em>Deep Dive</em>' });

    const message = renderWelcomeEmail(guest, hostile, 'upskills');

    expect(message.html).not.toContain('<em>');
    expect(message.html).toContain('&lt;em&gt;');
    // The subject is not HTML, so it keeps the characters as typed.
    expect(message.subject).toContain('Angular <em>Deep Dive</em>');
  });

  it('handles an event with no location set', () => {
    const noLocation = paidEventFixture({ location: undefined });

    for (const body of bodies(
      renderWelcomeEmail(guest, noLocation, 'upskills'),
    )) {
      expect(body).toContain('To be announced');
      expect(body).not.toContain('undefined');
    }
  });
});
