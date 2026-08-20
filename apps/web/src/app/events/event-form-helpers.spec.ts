import { describe, expect, it } from 'vitest';

import { imageUrlError, toIsoWithOffset } from './event-form-helpers';

describe('toIsoWithOffset', () => {
  it('stamps the offset in force at that wall time, across a DST change', () => {
    // Clocks go forward in Toronto at 02:00 on 2026-03-08. Reading the wall
    // time as UTC first lands before the change and would answer -05:00.
    expect(toIsoWithOffset('2026-03-08T03:30', 'America/Toronto')).toBe(
      '2026-03-08T03:30:00-04:00',
    );
    expect(toIsoWithOffset('2026-03-08T01:30', 'America/Toronto')).toBe(
      '2026-03-08T01:30:00-05:00',
    );
  });

  it('keeps the plain summer and winter offsets it always answered', () => {
    expect(toIsoWithOffset('2026-09-01T18:00', 'America/Toronto')).toBe(
      '2026-09-01T18:00:00-04:00',
    );
    expect(toIsoWithOffset('2026-01-01T18:00', 'America/Toronto')).toBe(
      '2026-01-01T18:00:00-05:00',
    );
    expect(toIsoWithOffset('2026-01-01T18:00', 'UTC')).toBe(
      '2026-01-01T18:00:00+00:00',
    );
  });
});

describe('imageUrlError', () => {
  it('accepts an empty value: the field is optional', () => {
    expect(imageUrlError('')).toBeNull();
    expect(imageUrlError('   ')).toBeNull();
  });

  it('accepts an absolute https URL', () => {
    expect(imageUrlError('https://example.com/poster.jpg')).toBeNull();
  });

  it('rejects http and other non-https values before any request is made', () => {
    expect(imageUrlError('http://example.com/poster.jpg')).toContain(
      'https://',
    );
    expect(imageUrlError('example.com/poster.jpg')).toContain('https://');
  });
});
