import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventFixture,
  guestFixture,
  paidEventFixture,
  timestampFor,
} from '../testing/fixtures';
import {
  CANCEL_PATH,
  cancelUrl,
  eventUrl,
  formatEventDay,
  formatEventWhen,
  formatMoney,
  formatPrice,
  greetingName,
  guestListUrl,
} from './format';

/**
 * Issues #43 and #44 — dates render in the event's zone and amounts in CAD.
 *
 * The time-zone tests do not assert "not UTC", which would pass on a server that
 * happened to be in UTC. They format one instant against two different events
 * and assert the two disagree by the offset between their zones: the only way
 * that holds is if the event's own `timezone` is what is being used.
 */

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('formatEventWhen', () => {
  it('renders the wall-clock time at the event, with the zone named', () => {
    expect(formatEventWhen(eventFixture())).toBe(
      'Thursday, September 3, 2026 at 6:30 p.m. EDT',
    );
  });

  it('renders the same instant differently for events in different zones', () => {
    const toronto = eventFixture({ timezone: 'America/Toronto' });
    const vancouver = eventFixture({ timezone: 'America/Vancouver' });

    expect(formatEventWhen(toronto)).toContain('6:30 p.m. EDT');
    expect(formatEventWhen(vancouver)).toContain('3:30 p.m. PDT');
  });

  it('follows daylight saving off the stored instant', () => {
    const winter = eventFixture({
      startsAt: timestampFor('2026-01-15T22:30:00.000Z'),
    });

    expect(formatEventWhen(winter)).toContain('5:30 p.m. EST');
  });

  it('falls back to UTC rather than throwing on an unusable zone', () => {
    // Unreachable through validation, but this runs after the registration has
    // already committed — a throw here is the failure the epic forbids.
    const broken = eventFixture({ timezone: 'Mars/Olympus_Mons' });

    expect(() => formatEventWhen(broken)).not.toThrow();
    expect(formatEventWhen(broken)).toContain('10:30 p.m. UTC');
  });
});

describe('formatEventDay', () => {
  it('drops the time and the year for subject lines', () => {
    expect(formatEventDay(eventFixture())).toBe('Thursday, September 3');
  });

  it('uses the event zone, so a late event does not shift a day', () => {
    const lateInVancouver = eventFixture({
      // 11:30 p.m. Vancouver on the 3rd is already the 4th in Toronto.
      startsAt: timestampFor('2026-09-04T06:30:00.000Z'),
      timezone: 'America/Vancouver',
    });

    expect(formatEventDay(lateInVancouver)).toBe('Thursday, September 3');
  });
});

describe('formatMoney', () => {
  it('renders cents as dollars with the currency spelled out', () => {
    expect(formatMoney(2500, 'cad')).toBe('$25.00 CAD');
  });

  it('keeps the cents that a bare dollar figure would hide', () => {
    expect(formatMoney(2599, 'cad')).toBe('$25.99 CAD');
    expect(formatMoney(5, 'cad')).toBe('$0.05 CAD');
  });

  it('says Free rather than $0.00 for a free event', () => {
    expect(formatPrice(eventFixture())).toBe('Free');
    expect(formatPrice(paidEventFixture())).toBe('$25.00 CAD');
  });
});

describe('cancelUrl', () => {
  it('carries the org, the event, the normalized address, and the token', () => {
    expect(cancelUrl(guestFixture())).toBe(
      `https://upskills.test${CANCEL_PATH}?org=org-upskills` +
        '&event=evt-typescript-101' +
        '&email=priya.raman%40example.com' +
        '&token=H1nQ8wZ3rTgKpLm2vXbA9fJd',
    );
  });

  it('uses the normalized id, not the casing the guest typed', () => {
    const guest = guestFixture({
      guestId: 'priya.raman@example.com',
      email: 'Priya.Raman@example.com',
    });

    // The cancel endpoint looks the guest up by document id; a link built from
    // the display-cased address would miss it.
    expect(cancelUrl(guest)).toContain('email=priya.raman%40example.com');
    expect(cancelUrl(guest)).not.toContain('Priya');
  });

  it('is unique per guest, because the token is', () => {
    const first = cancelUrl(guestFixture({ cancelToken: 'token-one' }));
    const second = cancelUrl(
      guestFixture({
        guestId: 'sam@example.com',
        email: 'sam@example.com',
        cancelToken: 'token-two',
      }),
    );

    expect(first).not.toBe(second);
    expect(first).toContain('token=token-one');
    expect(second).toContain('token=token-two');
  });

  it('escapes a token that contains url-significant characters', () => {
    const guest = guestFixture({ cancelToken: 'a+b/c=d&e' });

    expect(cancelUrl(guest)).toContain('token=a%2Bb%2Fc%3Dd%26e');
  });

  it('falls back to the local origin when SITE_URL is unset', () => {
    vi.stubEnv('SITE_URL', '');

    expect(cancelUrl(guestFixture())).toMatch(/^http:\/\/localhost:4200\//);
  });

  it('does not double the slash when SITE_URL has a trailing one', () => {
    vi.stubEnv('SITE_URL', 'https://upskills.test/');

    expect(
      cancelUrl(guestFixture()).startsWith(
        `https://upskills.test${CANCEL_PATH}?`,
      ),
    ).toBe(true);
  });
});

describe('links', () => {
  it('points at the event by org slug and event slug', () => {
    expect(eventUrl(eventFixture(), 'upskills')).toBe(
      'https://upskills.test/upskills/typescript-for-working-developers',
    );
  });

  it('points organizers at the guest list by event id', () => {
    expect(guestListUrl(eventFixture())).toBe(
      'https://upskills.test/dashboard/events/evt-typescript-101/guests',
    );
  });
});

describe('greetingName', () => {
  it('uses the first name', () => {
    expect(greetingName(guestFixture({ name: 'Priya Raman' }))).toBe('Priya');
  });

  it('handles a single-word name', () => {
    expect(greetingName(guestFixture({ name: 'Priya' }))).toBe('Priya');
  });

  it('never renders an empty greeting', () => {
    expect(greetingName(guestFixture({ name: '   ' }))).toBe('there');
    expect(greetingName(guestFixture({ name: '' }))).toBe('there');
  });
});
