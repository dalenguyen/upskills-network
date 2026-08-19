import { describe, expect, it } from 'vitest';
import {
  CreateOrgSchema,
  OrgMemberSchema,
  SetOrgMemberSchema,
} from './org.schema';

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
      CreateOrgSchema.safeParse({ name: '   ', slug: 'upskills' }).success,
    ).toBe(false);
  });

  it('rejects a name over 120 characters', () => {
    expect(
      CreateOrgSchema.safeParse({ name: 'a'.repeat(121), slug: 'upskills' })
        .success,
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

  it.each(['admin', 'dashboard', 'events', 'login'])(
    'rejects the reserved slug %j, which would shadow a top-level route',
    (slug) => {
      expect(CreateOrgSchema.safeParse({ name: 'Org', slug }).success).toBe(
        false,
      );
    },
  );
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

describe('SetOrgMemberSchema', () => {
  it('accepts a member named by uid', () => {
    expect(SetOrgMemberSchema.parse({ uid: 'uid-1', role: 'manager' })).toEqual(
      {
        uid: 'uid-1',
        role: 'manager',
      },
    );
  });

  it('accepts a member named by email, normalized', () => {
    expect(
      SetOrgMemberSchema.parse({ email: '  Ada@Example.COM ', role: 'admin' }),
    ).toEqual({ email: 'ada@example.com', role: 'admin' });
  });

  it('rejects an email that is not an address', () => {
    expect(
      SetOrgMemberSchema.safeParse({ email: 'ada', role: 'admin' }).success,
    ).toBe(false);
  });

  it('rejects a body that names neither a uid nor an email', () => {
    expect(SetOrgMemberSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('rejects a body with no role', () => {
    expect(
      SetOrgMemberSchema.safeParse({ email: 'ada@example.com' }).success,
    ).toBe(false);
  });
});
