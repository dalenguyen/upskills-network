import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventFixture, guestFixture } from '../../testing/fixtures';
import { cancelUrl } from '../format';
import { renderEventReminder } from './reminder';

/**
 * Issue #44 — the reminder carries the time in the event's zone, the location,
 * and the cancel link.
 *
 * The "cannot fire twice" criterion is not tested here, because it is not
 * implemented here: the sweep claims an event by stamping `reminderSentAt` in a
 * transaction, and this module renders one email for one guest. See the module
 * comment in `reminder.ts` for why a per-guest check on that field would be
 * actively wrong.
 */

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('event reminder', () => {
  it('names the event and the day in the subject', () => {
    expect(
      renderEventReminder(guestFixture(), eventFixture(), 'upskills').subject,
    ).toBe(
      'Reminder: TypeScript for Working Developers is on Thursday, September 3',
    );
  });

  it('gives the time in the event zone and the location, in both bodies', () => {
    const message = renderEventReminder(
      guestFixture(),
      eventFixture(),
      'upskills',
    );

    for (const body of [message.html, message.text]) {
      expect(body).toContain('Thursday, September 3, 2026 at 6:30 p.m. EDT');
      expect(body).toContain('Ada Room, 250 University Ave, Toronto');
    }
  });

  it('uses the event zone rather than the process zone', () => {
    const vancouver = eventFixture({ timezone: 'America/Vancouver' });

    expect(
      renderEventReminder(guestFixture(), vancouver, 'upskills').text,
    ).toContain('3:30 p.m. PDT');
  });

  it("carries the guest's own cancel link", () => {
    const guest = guestFixture();
    const message = renderEventReminder(guest, eventFixture(), 'upskills');
    const link = cancelUrl(guest);

    expect(message.text).toContain(link);
    expect(message.html).toContain(link.replace(/&/g, '&amp;'));
  });

  it('says something useful when the organizer set no location', () => {
    const message = renderEventReminder(
      guestFixture(),
      eventFixture({ location: undefined }),
      'upskills',
    );

    for (const body of [message.html, message.text]) {
      expect(body).toContain('To be announced');
      expect(body).not.toContain('undefined');
    }
  });
});
