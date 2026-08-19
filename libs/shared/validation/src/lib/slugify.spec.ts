import { describe, expect, it } from 'vitest';
import { OrgSlugSchema, SlugSchema } from './primitives';
import {
  RESERVED_SLUGS,
  isReservedSlug,
  nextSlugCandidate,
  slugify,
} from './slugify';

describe('slugify', () => {
  it.each([
    ['React Basics', 'react-basics'],
    ['React Basics: Part 2!', 'react-basics-part-2'],
    ['  padded  ', 'padded'],
    ['Multiple   spaces', 'multiple-spaces'],
    ['--leading and trailing--', 'leading-and-trailing'],
    ['UPPER', 'upper'],
    ['already-a-slug', 'already-a-slug'],
    ['Node.js & TypeScript', 'node-js-typescript'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('folds accents onto their base letter rather than dropping the letter', () => {
    expect(slugify('Café Découverte')).toBe('cafe-decouverte');
  });

  it('returns empty string when nothing survives, rather than inventing a slug', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('!!!')).toBe('');
  });

  it('produces a value SlugSchema accepts', () => {
    for (const title of ['React Basics: Part 2!', 'Café', 'a'.repeat(200)]) {
      expect(SlugSchema.safeParse(slugify(title)).success).toBe(true);
    }
  });

  it('truncates to the reservation id limit without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(79)} tail`);

    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('nextSlugCandidate', () => {
  it('returns the base unchanged for the first attempt', () => {
    expect(nextSlugCandidate('react-basics', 1)).toBe('react-basics');
  });

  it('numbers retries from 2, so the first retry reads as the second event', () => {
    expect(nextSlugCandidate('react-basics', 2)).toBe('react-basics-2');
    expect(nextSlugCandidate('react-basics', 3)).toBe('react-basics-3');
  });

  it('keeps candidates distinct and legal at the length limit', () => {
    const base = 'a'.repeat(80);
    const second = nextSlugCandidate(base, 2);
    const third = nextSlugCandidate(base, 3);

    expect(second).not.toBe(third);
    expect(second.length).toBeLessThanOrEqual(80);
    expect(SlugSchema.safeParse(second).success).toBe(true);
    expect(SlugSchema.safeParse(third).success).toBe(true);
  });

  it('does not leave a hyphen doubled where the base was cut', () => {
    expect(nextSlugCandidate(`${'a'.repeat(77)}-`, 2)).toBe(
      `${'a'.repeat(77)}-2`,
    );
  });
});

describe('OrgSlugSchema', () => {
  it('accepts an ordinary org slug', () => {
    expect(OrgSlugSchema.parse('upskills-toronto')).toBe('upskills-toronto');
  });

  it.each(['admin', 'api', 'dashboard', 'events', 'login', 'assets'])(
    'rejects the reserved slug %j, which would shadow a top-level route',
    (slug) => {
      expect(OrgSlugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it('rejects every entry in the reserved list', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(OrgSlugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('leaves reserved words alone once they are part of a longer slug', () => {
    expect(OrgSlugSchema.safeParse('admin-club').success).toBe(true);
    expect(OrgSlugSchema.safeParse('my-events').success).toBe(true);
  });

  it('does not constrain event slugs, which cannot shadow a route', () => {
    expect(SlugSchema.safeParse('dashboard').success).toBe(true);
  });

  it('still applies the shared slug rules', () => {
    expect(OrgSlugSchema.safeParse('Not A Slug').success).toBe(false);
    expect(OrgSlugSchema.safeParse('').success).toBe(false);
  });
});

describe('isReservedSlug', () => {
  it('matches case- and padding-insensitively, like the reservation id would', () => {
    expect(isReservedSlug(' Admin ')).toBe(true);
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('upskills')).toBe(false);
  });

  it('reserves every slug the app currently routes at the top level', () => {
    for (const route of [
      'admin',
      'auth',
      'dashboard',
      'events',
      'invites',
      'login',
      'api',
    ]) {
      expect(isReservedSlug(route)).toBe(true);
    }
  });
});
