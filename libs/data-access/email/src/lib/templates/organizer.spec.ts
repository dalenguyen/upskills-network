import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventFixture,
  guestFixture,
  paidEventFixture,
  paidGuestFixture,
} from '../../testing/fixtures';
import { setEmailClient, type EmailClient } from '../client';
import {
  renderOrganizerNotification,
  sendOrganizerNotification,
  type OrganizerNotificationType,
  type OrganizerRecipient,
} from './organizer';

/**
 * Issue #44 — organizer notifications reach the members with the relevant roles,
 * and nobody else.
 *
 * The fan-out tests use a stub client, so they assert who was mailed and what
 * happened when one of them failed, without a key and without the network. The
 * failure test is the important one: an organizer team is exactly the situation
 * where one stale address should not silence the notification for everyone else.
 */

const MEMBERS: OrganizerRecipient[] = [
  { email: 'admin@upskills.test', name: 'Ada', role: 'admin' },
  { email: 'manager@upskills.test', name: 'Malik', role: 'manager' },
  { email: 'door@upskills.test', name: 'Dee', role: 'check_in' },
  { email: 'help@upskills.test', name: 'Vik', role: 'volunteer' },
];

/** A client that records recipients and fails the ones named in `failFor`. */
function recordingClient(failFor: readonly string[] = []) {
  const sentTo: string[] = [];

  const client: EmailClient = {
    emails: {
      send: (payload) => {
        const to = String(payload.to);
        sentTo.push(to);

        return Promise.resolve(
          failFor.includes(to)
            ? {
                data: null,
                error: {
                  statusCode: 422,
                  name: 'validation_error' as const,
                  message: 'Invalid recipient',
                },
                headers: null,
              }
            : { data: { id: `re_${sentTo.length}` }, error: null, headers: null },
        ) as ReturnType<EmailClient['emails']['send']>;
      },
    },
  };

  return { client, sentTo };
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
  vi.stubEnv('RESEND_API_KEY', 'rk_test_key');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setEmailClient(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendOrganizerNotification', () => {
  it('mails the admins and managers, and not the door staff or volunteers', async () => {
    const { client, sentTo } = recordingClient();
    setEmailClient(client);

    const outcome = await sendOrganizerNotification(
      MEMBERS,
      eventFixture(),
      'registration',
      { guest: guestFixture() },
    );

    expect(sentTo).toEqual(['admin@upskills.test', 'manager@upskills.test']);
    expect(outcome).toMatchObject({ recipients: 2, sent: 2 });
  });

  it('sends one message per recipient, so a bad address cannot silence the rest', async () => {
    const { client, sentTo } = recordingClient(['admin@upskills.test']);
    setEmailClient(client);

    const outcome = await sendOrganizerNotification(
      MEMBERS,
      eventFixture(),
      'cancellation',
      { guest: guestFixture() },
    );

    expect(sentTo).toHaveLength(2);
    expect(outcome.sent).toBe(1);
    expect(outcome.results).toEqual([
      expect.objectContaining({
        to: 'admin@upskills.test',
        sent: false,
        reason: 'rejected',
      }),
      expect.objectContaining({ to: 'manager@upskills.test', sent: true }),
    ]);
  });

  it('does not throw when every recipient fails', async () => {
    setEmailClient({
      emails: {
        send: () => Promise.reject(new Error('socket hang up')),
      },
    });

    const outcome = await sendOrganizerNotification(
      MEMBERS,
      eventFixture(),
      'sold_out',
    );

    expect(outcome.sent).toBe(0);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((result) => !result.sent)).toBe(true);
  });

  it('mails each person once even when the caller repeats them', async () => {
    const { client, sentTo } = recordingClient();
    setEmailClient(client);

    await sendOrganizerNotification(
      [
        { email: 'admin@upskills.test', role: 'admin' },
        { email: 'ADMIN@upskills.test', role: 'manager' },
      ],
      eventFixture(),
      'registration',
    );

    expect(sentTo).toEqual(['admin@upskills.test']);
  });

  it('sends nothing, and reports it, when no member holds a relevant role', async () => {
    const { client, sentTo } = recordingClient();
    setEmailClient(client);

    const outcome = await sendOrganizerNotification(
      [{ email: 'door@upskills.test', role: 'check_in' }],
      eventFixture(),
      'registration',
    );

    expect(sentTo).toEqual([]);
    expect(outcome).toEqual({ recipients: 0, sent: 0, results: [] });
  });
});

describe('renderOrganizerNotification', () => {
  const types: OrganizerNotificationType[] = [
    'registration',
    'waitlist_joined',
    'cancellation',
    'sold_out',
    'payment_received',
    'refund_issued',
  ];

  it('gives every type its own subject, naming the event', () => {
    const subjects = types.map(
      (type) =>
        renderOrganizerNotification(
          'admin@upskills.test',
          eventFixture(),
          type,
        ).subject,
    );

    expect(new Set(subjects).size).toBe(types.length);
    for (const subject of subjects) {
      expect(subject).toContain('TypeScript for Working Developers');
    }
  });

  it('names the guest so the notification can be acted on', () => {
    const message = renderOrganizerNotification(
      'admin@upskills.test',
      eventFixture(),
      'registration',
      { guest: guestFixture() },
    );

    for (const body of [message.html, message.text]) {
      expect(body).toContain('Priya Raman');
      expect(body).toContain('Priya.Raman@example.com');
    }
  });

  it('reports capacity and waitlist depth, and links to the guest list', () => {
    const message = renderOrganizerNotification(
      'admin@upskills.test',
      eventFixture(),
      'sold_out',
    );

    expect(message.text).toContain('12 of 30');
    expect(message.text).toContain(
      'https://upskills.test/dashboard/events/evt-typescript-101/guests',
    );
  });

  it('does not print a capacity fraction for an event with no limit', () => {
    const message = renderOrganizerNotification(
      'admin@upskills.test',
      eventFixture({ maxGuests: 0 }),
      'registration',
    );

    expect(message.text).toContain('12 (no limit)');
    expect(message.text).not.toContain('of 0');
  });

  it('shows the amount on the money notifications, in CAD', () => {
    const paid = renderOrganizerNotification(
      'admin@upskills.test',
      paidEventFixture(),
      'payment_received',
      { guest: paidGuestFixture() },
    );
    const refunded = renderOrganizerNotification(
      'admin@upskills.test',
      paidEventFixture(),
      'refund_issued',
      { guest: paidGuestFixture() },
    );

    expect(paid.text).toContain('Amount: $25.00 CAD');
    expect(refunded.text).toContain('Refunded: $25.00 CAD');
  });

  it('works without a guest, for an event-level notification', () => {
    const message = renderOrganizerNotification(
      'admin@upskills.test',
      eventFixture(),
      'sold_out',
    );

    for (const body of [message.html, message.text]) {
      expect(body).not.toContain('undefined');
      expect(body).toContain('filled its last spot');
    }
  });

  it('renders the event time in the event zone', () => {
    const message = renderOrganizerNotification(
      'admin@upskills.test',
      eventFixture(),
      'registration',
    );

    expect(message.text).toContain('Thursday, September 3, 2026 at 6:30 p.m. EDT');
  });
});
