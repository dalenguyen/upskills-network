import { describe, expect, it } from 'vitest';

import { objectToArray } from './helpers';

describe('objectToArray', () => {
  it('converts an object to a KEY=VALUE array', () => {
    expect(objectToArray({ NODE_ENV: 'production', PORT: '8080' })).toEqual([
      'NODE_ENV=production',
      'PORT=8080',
    ]);
  });

  it('returns an empty array for an empty object', () => {
    expect(objectToArray({})).toEqual([]);
  });
});
