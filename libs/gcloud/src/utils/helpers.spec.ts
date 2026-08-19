import { describe, expect, it } from 'vitest';

import { objectToArray, shellQuote } from './helpers';

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

describe('shellQuote', () => {
  it('wraps a value in single quotes', () => {
    expect(shellQuote('production')).toBe("'production'");
  });

  it('protects spaces and angle brackets', () => {
    expect(shellQuote('Upskills Network <dale@example.com>')).toBe(
      "'Upskills Network <dale@example.com>'",
    );
  });

  it("escapes an embedded single quote with the '\\'' idiom", () => {
    expect(shellQuote("don't")).toBe("'don'\\''t'");
  });
});
