import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MEDIA_BUCKET_ENV,
  MEDIA_CACHE_CONTROL,
  mediaBucketName,
  objectPathForPublicUrl,
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

describe('objectPathForPublicUrl', () => {
  it('returns the object path inside the given bucket', () => {
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/orgs/org-1/event-media/abc.jpg',
      ),
    ).toBe('orgs/org-1/event-media/abc.jpg');
  });

  it('round-trips a path that publicUrlForPath had to encode', () => {
    const objectPath = 'orgs/org-1/event-media/hero #1 & poster.jpg';

    expect(
      objectPathForPublicUrl('bucket', publicUrlForPath('bucket', objectPath)),
    ).toBe(objectPath);
  });

  it('returns null for a URL that is not served by Cloud Storage', () => {
    expect(
      objectPathForPublicUrl('bucket', 'https://images.example.com/x.jpg'),
    ).toBeNull();
  });

  it('returns null for a foreign host whose path starts with the bucket name', () => {
    // The origin check is what refuses this, and nothing else would: the path
    // is shaped exactly like one of ours, so the bucket and segment checks
    // below it all pass. `imageUrl` is a value an organizer pastes, so without
    // the origin check someone could point a draft event at
    // `https://evil.example.com/<bucket>/orgs/<other org>/...`, delete the
    // draft, and have the delete path remove another organizer's object.
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://evil.example.com/bucket/orgs/other-org/event-media/abc.jpg',
      ),
    ).toBeNull();
  });

  it('returns null when the first path segment is a different bucket', () => {
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/other-bucket/orgs/org-1/x.jpg',
      ),
    ).toBeNull();
  });

  it('returns null for a malformed URL rather than throwing', () => {
    expect(objectPathForPublicUrl('bucket', 'not a url')).toBeNull();
    expect(objectPathForPublicUrl('bucket', 'https://')).toBeNull();
  });

  it('returns null for a non-absolute URL rather than throwing', () => {
    expect(objectPathForPublicUrl('bucket', '/orgs/org-1/x.jpg')).toBeNull();
    expect(objectPathForPublicUrl('bucket', 'orgs/org-1/x.jpg')).toBeNull();
  });

  it('returns null when a decoded segment is empty, "." or ".."', () => {
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/orgs//x.jpg',
      ),
    ).toBeNull();
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/orgs/./x.jpg',
      ),
    ).toBeNull();
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/orgs/a/../x.jpg',
      ),
    ).toBeNull();
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/orgs/%2E%2E/x.jpg',
      ),
    ).toBeNull();
  });

  it('returns null when the URL names no object path after the bucket', () => {
    expect(
      objectPathForPublicUrl('bucket', 'https://storage.googleapis.com/bucket'),
    ).toBeNull();
    expect(
      objectPathForPublicUrl(
        'bucket',
        'https://storage.googleapis.com/bucket/',
      ),
    ).toBeNull();
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
