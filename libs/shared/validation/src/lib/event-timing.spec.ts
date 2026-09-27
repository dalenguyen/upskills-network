import { describe, expect, it } from 'vitest';
import { UPCOMING_GRACE_MS, isPastEvent, upcomingCutoff } from './event-timing';

const now = new Date('2026-09-27T18:00:00.000Z');

describe('upcomingCutoff', () => {
  it('sits three hours before now', () => {
    expect(upcomingCutoff(now).toISOString()).toBe('2026-09-27T15:00:00.000Z');
    expect(UPCOMING_GRACE_MS).toBe(3 * 60 * 60 * 1000);
  });
});

describe('isPastEvent', () => {
  it('keeps an event that started inside the grace window upcoming', () => {
    expect(isPastEvent(new Date('2026-09-27T16:00:00.000Z'), now)).toBe(false);
  });

  it('keeps an event that starts exactly at the cutoff upcoming', () => {
    expect(isPastEvent(upcomingCutoff(now), now)).toBe(false);
  });

  it('marks an event past once the grace window has run out', () => {
    expect(isPastEvent(new Date('2026-09-27T14:59:59.999Z'), now)).toBe(true);
  });

  it('keeps a future event upcoming', () => {
    expect(isPastEvent(new Date('2026-10-01T18:00:00.000Z'), now)).toBe(false);
  });
});
