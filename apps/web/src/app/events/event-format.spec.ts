import { describe, expect, it } from 'vitest';

import {
  formatEventWhen,
  formatLocationUrl,
  formatPrice,
  formatSpots,
} from './event-format';

describe('formatPrice', () => {
  it('names a zero price rather than printing $0.00', () => {
    expect(formatPrice(0, 'cad')).toBe('Free');
  });

  it('renders minor units as major units with the currency', () => {
    expect(formatPrice(4500, 'cad')).toBe('$45.00 CAD');
  });
});

describe('formatLocationUrl', () => {
  it('builds a Google Maps search URL from the location text', () => {
    expect(formatLocationUrl('MaRS Centre, Toronto')).toBe(
      'https://www.google.com/maps/search/?api=1&query=MaRS%20Centre%2C%20Toronto',
    );
  });

  it('trims surrounding whitespace before building the query', () => {
    expect(formatLocationUrl('  Room 3  ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Room%203',
    );
  });
});

describe('formatEventWhen', () => {
  const timezone = 'America/Toronto';

  it('renders the start in the event timezone, not the viewer timezone', () => {
    // 2026-09-10T13:30Z is 09:30 in Toronto (EDT, UTC-4).
    const when = formatEventWhen(
      '2026-09-10T13:30:00.000Z',
      undefined,
      timezone,
    );

    expect(when).toContain('September 10, 2026');
    expect(when).toContain('9:30');
  });

  it('renders the date alone when the start time is unknown', () => {
    // A curated listing whose source published a date and no time. `startsAt`
    // still holds an instant because that is what the event sorts by, but the
    // hour is a placeholder and must never be shown as fact.
    const when = formatEventWhen(
      '2026-09-10T13:00:00.000Z',
      undefined,
      timezone,
      true,
    );

    expect(when).toBe('September 10, 2026 · time TBA');
    expect(when).not.toContain('9:00');
  });

  it('suppresses an end time too when the start time is unknown', () => {
    const when = formatEventWhen(
      '2026-09-10T13:00:00.000Z',
      '2026-09-10T21:00:00.000Z',
      timezone,
      true,
    );

    expect(when).toBe('September 10, 2026 · time TBA');
  });

  it('appends an end time when the event has one', () => {
    const when = formatEventWhen(
      '2026-09-10T13:30:00.000Z',
      '2026-09-10T16:00:00.000Z',
      timezone,
    );

    expect(when).toContain('9:30');
    expect(when).toContain('12:00');
  });

  it('falls back to the raw value when the date cannot be parsed', () => {
    expect(formatEventWhen('not-a-date', undefined, timezone)).toBe(
      'not-a-date',
    );
  });
});

describe('formatSpots', () => {
  it('says nothing when capacity is unlimited', () => {
    expect(formatSpots(null, 0)).toBeNull();
  });

  it('says nothing when the count is not scarce enough to matter', () => {
    expect(formatSpots(40, 50)).toBeNull();
  });

  it('singularises the last spot', () => {
    expect(formatSpots(1, 10)).toBe('1/10 spot left');
  });

  it('counts down once the number is small enough to create urgency', () => {
    expect(formatSpots(6, 10)).toBe('6/10 spots left');
  });

  it('says nothing at zero — the sold-out state speaks for itself', () => {
    expect(formatSpots(0, 10)).toBeNull();
  });
});
