import { describe, expect, it } from 'vitest';
import * as validation from './index';

/**
 * Guards the public surface: every route boundary imports from this barrel, and
 * `normalizeEmail` must be the single exported normalizer (issue #29).
 */
describe('@upskills/validation entrypoint', () => {
  it.each([
    'CreateEventSchema',
    'UpdateEventSchema',
    'RegisterGuestSchema',
    'CancelGuestSchema',
    'LookupSchema',
    'CreateOrgSchema',
    'OrgMemberSchema',
    'CheckInSchema',
  ])('exports %s', (name) => {
    expect(validation).toHaveProperty(name);
  });

  it('exports exactly one email normalizer', () => {
    const normalizers = Object.keys(validation).filter((key) =>
      /normali[sz]e.*email/i.test(key),
    );

    expect(normalizers).toEqual(['normalizeEmail']);
  });

  it('routes the email schema through that normalizer', () => {
    expect(validation.EmailSchema.parse(' Foo@Bar.COM ')).toBe(
      validation.normalizeEmail(' Foo@Bar.COM '),
    );
  });
});
