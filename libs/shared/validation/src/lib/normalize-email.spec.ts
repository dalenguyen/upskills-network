import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('trims and lowercases (the acceptance criterion)', () => {
    expect(normalizeEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('is idempotent — re-normalizing a doc id yields the same doc id', () => {
    const once = normalizeEmail('  Guest@Example.COM\n');

    expect(normalizeEmail(once)).toBe(once);
  });

  it('strips surrounding whitespace of every flavour', () => {
    expect(normalizeEmail('\t\n guest@example.com \r\n')).toBe(
      'guest@example.com',
    );
  });

  it('leaves an already-normal address untouched', () => {
    expect(normalizeEmail('guest@example.com')).toBe('guest@example.com');
  });

  it('does not strip dots or +tags — those are distinct mailboxes', () => {
    expect(normalizeEmail('First.Last+Workshop@Example.com')).toBe(
      'first.last+workshop@example.com',
    );
  });

  it('collapses case-only variants onto one doc id', () => {
    const ids = [
      'guest@example.com',
      'GUEST@EXAMPLE.COM',
      ' Guest@Example.Com',
    ].map(normalizeEmail);

    expect(new Set(ids).size).toBe(1);
  });
});
