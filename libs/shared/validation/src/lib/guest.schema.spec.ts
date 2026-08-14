import { describe, expect, it } from 'vitest';
import {
  CancelGuestSchema,
  CheckInSchema,
  LookupSchema,
  RegisterGuestSchema,
} from './guest.schema';

describe('RegisterGuestSchema', () => {
  it('normalizes the email and trims the name', () => {
    expect(
      RegisterGuestSchema.parse({
        email: ' Guest@Example.COM ',
        name: '  Grace Hopper  ',
      }),
    ).toEqual({ email: 'guest@example.com', name: 'Grace Hopper' });
  });

  it('rejects an invalid email', () => {
    const result = RegisterGuestSchema.safeParse({
      email: 'not-an-email',
      name: 'Grace',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['email']);
  });

  it('rejects a blank name', () => {
    expect(
      RegisterGuestSchema.safeParse({ email: 'g@example.com', name: '   ' })
        .success,
    ).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(
      RegisterGuestSchema.safeParse({ email: 'g@example.com' }).success,
    ).toBe(false);
  });

  it('rejects a name over 120 characters', () => {
    expect(
      RegisterGuestSchema.safeParse({
        email: 'g@example.com',
        name: 'a'.repeat(121),
      }).success,
    ).toBe(false);
  });

  it('does not take an eventId from the body', () => {
    const parsed = RegisterGuestSchema.parse({
      email: 'g@example.com',
      name: 'Grace',
      eventId: 'another-event',
    });

    expect(parsed).not.toHaveProperty('eventId');
  });
});

describe('CancelGuestSchema', () => {
  it('accepts an email plus a cancel token', () => {
    expect(
      CancelGuestSchema.parse({
        email: ' Guest@Example.com ',
        cancelToken: 'tok_abc123',
      }),
    ).toEqual({ email: 'guest@example.com', cancelToken: 'tok_abc123' });
  });

  it('rejects a missing cancelToken — the email alone is not authorization', () => {
    const result = CancelGuestSchema.safeParse({ email: 'guest@example.com' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['cancelToken']);
  });

  it('rejects an empty or whitespace-only cancelToken', () => {
    expect(
      CancelGuestSchema.safeParse({ email: 'g@example.com', cancelToken: '' })
        .success,
    ).toBe(false);
    expect(
      CancelGuestSchema.safeParse({ email: 'g@example.com', cancelToken: '  ' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-string cancelToken', () => {
    expect(
      CancelGuestSchema.safeParse({ email: 'g@example.com', cancelToken: 123 })
        .success,
    ).toBe(false);
  });
});

describe('LookupSchema', () => {
  it('normalizes the email so the lookup hits the same doc id', () => {
    expect(LookupSchema.parse({ email: ' Foo@Bar.COM ' })).toEqual({
      email: 'foo@bar.com',
    });
  });

  it('rejects a missing email', () => {
    expect(LookupSchema.safeParse({}).success).toBe(false);
  });
});

describe('CheckInSchema', () => {
  it('normalizes the email into the guest doc id', () => {
    expect(CheckInSchema.parse({ email: 'HERE@Example.com' })).toEqual({
      email: 'here@example.com',
    });
  });

  it('rejects an invalid email', () => {
    expect(CheckInSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});
