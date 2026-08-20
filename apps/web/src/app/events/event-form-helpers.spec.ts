import { describe, expect, it } from 'vitest';

import { imageUrlError } from './event-form-helpers';

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
