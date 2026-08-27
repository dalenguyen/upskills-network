import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MEDIA_BUCKET_ENV,
  MEDIA_CACHE_CONTROL,
  mediaBucketName,
  publicUrlForPath,
} from './config';

describe('mediaBucketName', () => {
  const original = process.env[MEDIA_BUCKET_ENV];

  beforeEach(() => {
    delete process.env[MEDIA_BUCKET_ENV];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[MEDIA_BUCKET_ENV];
    } else {
      process.env[MEDIA_BUCKET_ENV] = original;
    }
  });

  it('returns the configured bucket name', () => {
    process.env[MEDIA_BUCKET_ENV] = 'upskills-network-media';

    expect(mediaBucketName()).toBe('upskills-network-media');
  });

  it('trims surrounding whitespace', () => {
    process.env[MEDIA_BUCKET_ENV] = '  upskills-network-media  ';

    expect(mediaBucketName()).toBe('upskills-network-media');
  });

  it('throws when the variable is missing', () => {
    expect(() => mediaBucketName()).toThrow(MEDIA_BUCKET_ENV);
  });

  it('treats a blank value as missing rather than as a bucket named ""', () => {
    process.env[MEDIA_BUCKET_ENV] = '   ';

    expect(() => mediaBucketName()).toThrow(MEDIA_BUCKET_ENV);
  });
});

describe('publicUrlForPath', () => {
  it('builds the public Cloud Storage URL', () => {
    expect(publicUrlForPath('bucket', 'orgs/org-1/event-media/abc.jpg')).toBe(
      'https://storage.googleapis.com/bucket/orgs/org-1/event-media/abc.jpg',
    );
  });

  it('keeps the separating slashes while encoding within a segment', () => {
    expect(publicUrlForPath('bucket', 'orgs/a b/hero c.jpg')).toBe(
      'https://storage.googleapis.com/bucket/orgs/a%20b/hero%20c.jpg',
    );
  });

  // `.` is unreserved, so encodeURIComponent('..') === '..' and the traversal
  // would otherwise reach the URL intact.
  it.each(['orgs/a/../b/x.jpg', 'orgs/./x.jpg', '../x.jpg', 'orgs/..'])(
    'rejects the traversal path %s',
    (objectPath) => {
      expect(() => publicUrlForPath('bucket', objectPath)).toThrow(
        'Invalid object path',
      );
    },
  );

  it.each(['', '/x.jpg', 'orgs//x.jpg', 'orgs/x.jpg/'])(
    'rejects the empty segment in %s',
    (objectPath) => {
      expect(() => publicUrlForPath('bucket', objectPath)).toThrow(
        'Invalid object path',
      );
    },
  );

  it('allows a dot inside a segment', () => {
    expect(publicUrlForPath('bucket', 'orgs/org-1/a.b.jpg')).toBe(
      'https://storage.googleapis.com/bucket/orgs/org-1/a.b.jpg',
    );
  });
});

describe('MEDIA_CACHE_CONTROL', () => {
  // Cloud Storage's default for a public object is `public, max-age=3600`,
  // which keeps a deleted object readable at its own URL for the rest of the
  // hour. Uploads must therefore set this header explicitly rather than inherit
  // the default, so this asserts the value is a deliberate immutable one.
  it('is an explicit immutable public policy', () => {
    expect(MEDIA_CACHE_CONTROL).toContain('public');
    expect(MEDIA_CACHE_CONTROL).toContain('immutable');
    expect(MEDIA_CACHE_CONTROL).not.toContain('max-age=3600');
  });
});
