import { describe, expect, it } from 'vitest';

import {
  heroImageFileError,
  heroImageUploadErrorMessage,
  imageUrlError,
  MAX_HERO_IMAGE_BYTES,
  toIsoWithOffset,
} from './event-form-helpers';

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

describe('heroImageFileError', () => {
  it('accepts JPEG, PNG, and WebP files at or under 5 MB', () => {
    expect(heroImageFileError({ size: 1, type: 'image/jpeg' })).toBeNull();
    expect(heroImageFileError({ size: 1, type: 'image/png' })).toBeNull();
    expect(heroImageFileError({ size: 1, type: 'image/webp' })).toBeNull();
    expect(
      heroImageFileError({ size: MAX_HERO_IMAGE_BYTES, type: 'image/jpeg' }),
    ).toBeNull();
  });

  it('refuses a file over 5 MB before any upload starts', () => {
    const message = heroImageFileError({
      size: MAX_HERO_IMAGE_BYTES + 1,
      type: 'image/jpeg',
    });

    expect(message).toContain('5 MB');
  });

  it('refuses an unsupported type and names the accepted types', () => {
    const message = heroImageFileError({
      size: 1,
      type: 'image/gif',
    });

    expect(message).toContain('JPEG');
    expect(message).toContain('PNG');
    expect(message).toContain('WebP');
  });

  it('checks the size before the type', () => {
    const message = heroImageFileError({
      size: MAX_HERO_IMAGE_BYTES + 1,
      type: 'image/gif',
    });

    expect(message).toContain('5 MB');
  });
});

describe('heroImageUploadErrorMessage', () => {
  it('maps 413 to a file-too-large message', () => {
    expect(heroImageUploadErrorMessage(413)).toContain('too large');
  });

  it('maps 400 to an unsupported-type message that names the accepted types', () => {
    const message = heroImageUploadErrorMessage(400);

    expect(message).toContain('JPEG');
    expect(message).toContain('PNG');
    expect(message).toContain('WebP');
  });

  it('maps any other status to a generic retryable message', () => {
    expect(heroImageUploadErrorMessage(500)).toContain('Try again');
    expect(heroImageUploadErrorMessage(422)).toContain('Try again');
  });

  it('maps a missing status to the generic retryable message', () => {
    expect(heroImageUploadErrorMessage(null)).toContain('Try again');
  });
});
