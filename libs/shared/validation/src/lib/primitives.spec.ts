import { describe, expect, it } from 'vitest';
import {
  CancelTokenSchema,
  CurrencySchema,
  EmailSchema,
  EventStatusSchema,
  GuestStatusSchema,
  IdSchema,
  IsoDateTimeSchema,
  MaxGuestsSchema,
  OrgRoleSchema,
  PriceSchema,
  SlugSchema,
  TimezoneSchema,
} from './primitives';
import { normalizeEmail } from './normalize-email';

describe('EmailSchema', () => {
  it('normalizes before validating', () => {
    expect(EmailSchema.parse(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('produces exactly what normalizeEmail produces (guest doc id)', () => {
    const raw = '  Guest+Tag@Example.COM ';

    expect(EmailSchema.parse(raw)).toBe(normalizeEmail(raw));
  });

  it.each(['', '   ', 'not-an-email', 'foo@', '@bar.com', 'foo bar@baz.com'])(
    'rejects %j',
    (value) => {
      expect(EmailSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects non-string input', () => {
    expect(EmailSchema.safeParse(42).success).toBe(false);
    expect(EmailSchema.safeParse(undefined).success).toBe(false);
    expect(EmailSchema.safeParse(null).success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it.each(['intro-to-networking', 'a', 'workshop-2026', '123'])(
    'accepts %j',
    (value) => {
      expect(SlugSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    'Intro-To-Networking',
    'intro to networking',
    'intro_to_networking',
    'intro--to--networking!',
    'café',
    '',
    'sluggy/path',
  ])('rejects %j', (value) => {
    expect(SlugSchema.safeParse(value).success).toBe(false);
  });

  it('trims before matching', () => {
    expect(SlugSchema.parse('  my-slug  ')).toBe('my-slug');
  });

  it('rejects a slug longer than 80 chars', () => {
    expect(SlugSchema.safeParse('a'.repeat(80)).success).toBe(true);
    expect(SlugSchema.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

describe('PriceSchema', () => {
  it('accepts 0 (free) and positive integer cents', () => {
    expect(PriceSchema.parse(0)).toBe(0);
    expect(PriceSchema.parse(2500)).toBe(2500);
  });

  it('rejects negative amounts', () => {
    expect(PriceSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects fractional cents — price is in minor units', () => {
    expect(PriceSchema.safeParse(25.5).success).toBe(false);
  });

  it('rejects non-numbers and NaN', () => {
    expect(PriceSchema.safeParse('2500').success).toBe(false);
    expect(PriceSchema.safeParse(Number.NaN).success).toBe(false);
  });
});

describe('CurrencySchema', () => {
  it('accepts cad', () => {
    expect(CurrencySchema.parse('cad')).toBe('cad');
  });

  it.each(['usd', 'CAD', 'eur', ''])('rejects %j', (value) => {
    expect(CurrencySchema.safeParse(value).success).toBe(false);
  });
});

describe('MaxGuestsSchema', () => {
  it('accepts 0, which means unlimited', () => {
    expect(MaxGuestsSchema.parse(0)).toBe(0);
  });

  it('accepts a positive capacity', () => {
    expect(MaxGuestsSchema.parse(30)).toBe(30);
  });

  it('rejects negative capacity', () => {
    expect(MaxGuestsSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects a fractional capacity', () => {
    expect(MaxGuestsSchema.safeParse(2.5).success).toBe(false);
  });
});

describe('TimezoneSchema', () => {
  it.each(['America/Toronto', 'UTC', 'Europe/Paris'])(
    'accepts the IANA zone %j',
    (value) => {
      expect(TimezoneSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    'Mars/Olympus',
    'america/toronto',
    'EST5EDT+1',
    '-04:00',
    'GMT-5',
    '',
  ])('rejects %j', (value) => {
    expect(TimezoneSchema.safeParse(value).success).toBe(false);
  });

  it('trims before lookup', () => {
    expect(TimezoneSchema.parse(' America/Toronto ')).toBe('America/Toronto');
  });
});

describe('IsoDateTimeSchema', () => {
  it.each(['2026-09-01T18:00:00Z', '2026-09-01T18:00:00-04:00'])(
    'accepts %j',
    (value) => {
      expect(IsoDateTimeSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    '2026-09-01T18:00:00', // no offset — ambiguous instant
    '2026-09-01',
    '01/09/2026',
    'tomorrow',
    '',
  ])('rejects %j', (value) => {
    expect(IsoDateTimeSchema.safeParse(value).success).toBe(false);
  });
});

describe('CancelTokenSchema', () => {
  it('accepts a token', () => {
    expect(CancelTokenSchema.parse('tok_abc123')).toBe('tok_abc123');
  });

  it.each(['', '   '])('rejects the empty token %j', (value) => {
    expect(CancelTokenSchema.safeParse(value).success).toBe(false);
  });
});

describe('IdSchema', () => {
  it('trims and requires at least one character', () => {
    expect(IdSchema.parse(' uid-1 ')).toBe('uid-1');
    expect(IdSchema.safeParse('  ').success).toBe(false);
  });
});

describe('enum schemas', () => {
  it('OrgRoleSchema covers exactly the four org roles', () => {
    expect(OrgRoleSchema.options).toEqual([
      'admin',
      'manager',
      'check_in',
      'volunteer',
    ]);
    expect(OrgRoleSchema.safeParse('owner').success).toBe(false);
  });

  it('EventStatusSchema covers the full lifecycle', () => {
    expect(EventStatusSchema.options).toEqual([
      'draft',
      'published',
      'cancelled',
    ]);
    expect(EventStatusSchema.safeParse('archived').success).toBe(false);
  });

  it('GuestStatusSchema covers all five registration states', () => {
    expect(GuestStatusSchema.options).toEqual([
      'confirmed',
      'held',
      'pending',
      'cancelled',
      'expired',
    ]);
    expect(GuestStatusSchema.safeParse('waitlisted').success).toBe(false);
  });
});
