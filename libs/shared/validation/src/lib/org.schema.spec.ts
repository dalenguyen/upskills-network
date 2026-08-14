import { describe, expect, it } from 'vitest';
import { CreateOrgSchema, OrgMemberSchema } from './org.schema';

describe('CreateOrgSchema', () => {
  it('accepts a name and slug', () => {
    expect(
      CreateOrgSchema.parse({
        name: '  Upskills Toronto  ',
        slug: 'upskills-toronto',
      }),
    ).toEqual({ name: 'Upskills Toronto', slug: 'upskills-toronto' });
  });

  it('rejects a blank name', () => {
    expect(
      CreateOrgSchema.safeParse({ name: '   ', slug: 'org' }).success,
    ).toBe(false);
  });

  it('rejects a name over 120 characters', () => {
    expect(
      CreateOrgSchema.safeParse({ name: 'a'.repeat(121), slug: 'org' }).success,
    ).toBe(false);
  });

  it.each(['Upskills-Toronto', 'upskills toronto', 'upskills_toronto', ''])(
    'rejects the invalid slug %j',
    (slug) => {
      expect(CreateOrgSchema.safeParse({ name: 'Org', slug }).success).toBe(
        false,
      );
    },
  );

  it('rejects a missing slug', () => {
    expect(CreateOrgSchema.safeParse({ name: 'Org' }).success).toBe(false);
  });
});

describe('OrgMemberSchema', () => {
  it.each(['admin', 'manager', 'check_in', 'volunteer'])(
    'accepts the role %j',
    (role) => {
      expect(OrgMemberSchema.parse({ uid: 'uid-1', role })).toEqual({
        uid: 'uid-1',
        role,
      });
    },
  );

  it.each(['owner', 'Admin', 'check-in', ''])('rejects the role %j', (role) => {
    expect(OrgMemberSchema.safeParse({ uid: 'uid-1', role }).success).toBe(
      false,
    );
  });

  it('rejects a blank uid', () => {
    expect(
      OrgMemberSchema.safeParse({ uid: '  ', role: 'admin' }).success,
    ).toBe(false);
  });

  it('rejects a missing role', () => {
    expect(OrgMemberSchema.safeParse({ uid: 'uid-1' }).success).toBe(false);
  });
});
