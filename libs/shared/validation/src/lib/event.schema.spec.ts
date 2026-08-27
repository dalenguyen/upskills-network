import { describe, expect, it } from 'vitest';
import {
  CreateEventSchema,
  HeroImageSchema,
  UpdateEventSchema,
} from './event.schema';

/** Builds a copy of `source` without the given keys. */
function without<T extends object, K extends keyof T>(
  source: T,
  ...keys: readonly K[]
): Omit<T, K> {
  const kept = Object.entries(source).filter(
    ([key]) => !keys.includes(key as K),
  );
  return Object.fromEntries(kept) as Omit<T, K>;
}

const validEvent = {
  title: 'Intro to Networking',
  slug: 'intro-to-networking',
  description: 'A hands-on session.',
  startsAt: '2026-09-01T18:00:00Z',
  endsAt: '2026-09-01T20:00:00Z',
  timezone: 'America/Toronto',
  location: 'Toronto Reference Library',
  price: 2500,
  currency: 'cad',
  maxGuests: 30,
};

const validHeroImage = {
  // Shaped like what the upload route actually writes: keyed by org and by an
  // unguessable media id, with no event id in the path (the event does not
  // exist yet when the upload happens).
  storagePath: 'orgs/org-1/event-media/7f3c9a2b4d.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 1_000_000,
  uploadedAt: '2026-09-01T18:00:00Z',
};

/** `heroImage` is bookkeeping about `imageUrl`, so the two travel together. */
const validUploadedEvent = {
  ...validEvent,
  imageUrl: 'https://storage.googleapis.com/upskills-network-media/x.jpg',
  heroImage: validHeroImage,
};

describe('HeroImageSchema', () => {
  it('accepts a valid uploaded hero image', () => {
    expect(HeroImageSchema.parse(validHeroImage)).toEqual(validHeroImage);
  });

  it('rejects an empty storagePath', () => {
    const result = HeroImageSchema.safeParse({
      ...validHeroImage,
      storagePath: '   ',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['storagePath']);
  });

  it('rejects a disallowed content type', () => {
    const result = HeroImageSchema.safeParse({
      ...validHeroImage,
      contentType: 'image/gif',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['contentType']);
  });

  it('rejects a non-positive size', () => {
    expect(
      HeroImageSchema.safeParse({ ...validHeroImage, sizeBytes: 0 }).success,
    ).toBe(false);
    expect(
      HeroImageSchema.safeParse({ ...validHeroImage, sizeBytes: -1 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer size', () => {
    expect(
      HeroImageSchema.safeParse({ ...validHeroImage, sizeBytes: 1_000.5 })
        .success,
    ).toBe(false);
  });

  it('rejects a size over 5 MB', () => {
    expect(
      HeroImageSchema.safeParse({
        ...validHeroImage,
        sizeBytes: 5 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects an uploadedAt without an offset', () => {
    const result = HeroImageSchema.safeParse({
      ...validHeroImage,
      uploadedAt: '2026-09-01T18:00:00',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['uploadedAt']);
  });
});

describe('CreateEventSchema', () => {
  it('accepts a fully specified event', () => {
    const parsed = CreateEventSchema.parse(validEvent);

    expect(parsed.title).toBe('Intro to Networking');
    expect(parsed.price).toBe(2500);
  });

  it('accepts a valid heroImage alongside the URL it describes', () => {
    const parsed = CreateEventSchema.parse(validUploadedEvent);

    expect(parsed.heroImage).toEqual(validHeroImage);
    expect(parsed.imageUrl).toBe(validUploadedEvent.imageUrl);
  });

  it('allows heroImage to be omitted', () => {
    expect(CreateEventSchema.parse(validEvent).heroImage).toBeUndefined();
  });

  it('still accepts a pasted imageUrl with no heroImage', () => {
    const parsed = CreateEventSchema.parse({
      ...validEvent,
      imageUrl: 'https://example.com/poster.jpg',
    });

    expect(parsed.imageUrl).toBe('https://example.com/poster.jpg');
    expect(parsed.heroImage).toBeUndefined();
  });

  it('rejects heroImage without the imageUrl it is bookkeeping for', () => {
    const result = CreateEventSchema.safeParse({
      ...validEvent,
      heroImage: validHeroImage,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === 'heroImage')).toBe(
      true,
    );
  });

  it('rejects a heroImage with an oversized upload', () => {
    expect(
      CreateEventSchema.safeParse({
        ...validUploadedEvent,
        heroImage: { ...validHeroImage, sizeBytes: 5 * 1024 * 1024 + 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a heroImage with a disallowed content type', () => {
    expect(
      CreateEventSchema.safeParse({
        ...validUploadedEvent,
        heroImage: { ...validHeroImage, contentType: 'image/gif' },
      }).success,
    ).toBe(false);
  });

  it('defaults status to draft', () => {
    expect(CreateEventSchema.parse(validEvent).status).toBe('draft');
  });

  it('accepts an explicit published status', () => {
    expect(
      CreateEventSchema.parse({ ...validEvent, status: 'published' }).status,
    ).toBe('published');
  });

  it('rejects cancelled at creation time', () => {
    expect(
      CreateEventSchema.safeParse({ ...validEvent, status: 'cancelled' })
        .success,
    ).toBe(false);
  });

  it('accepts a free event and an unlimited capacity', () => {
    const parsed = CreateEventSchema.parse({
      ...validEvent,
      price: 0,
      maxGuests: 0,
    });

    expect(parsed.price).toBe(0);
    expect(parsed.maxGuests).toBe(0);
  });

  it('rejects a negative price', () => {
    expect(
      CreateEventSchema.safeParse({ ...validEvent, price: -1 }).success,
    ).toBe(false);
  });

  it('rejects a negative maxGuests', () => {
    expect(
      CreateEventSchema.safeParse({ ...validEvent, maxGuests: -1 }).success,
    ).toBe(false);
  });

  it('rejects a non-CAD currency', () => {
    const result = CreateEventSchema.safeParse({
      ...validEvent,
      currency: 'usd',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['currency']);
  });

  it('rejects an invalid slug', () => {
    const result = CreateEventSchema.safeParse({
      ...validEvent,
      slug: 'Intro To Networking',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['slug']);
  });

  it('rejects an unknown timezone', () => {
    const result = CreateEventSchema.safeParse({
      ...validEvent,
      timezone: 'Mars/Olympus',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['timezone']);
  });

  it('rejects an empty title', () => {
    expect(
      CreateEventSchema.safeParse({ ...validEvent, title: '   ' }).success,
    ).toBe(false);
  });

  it('trims the title', () => {
    expect(
      CreateEventSchema.parse({ ...validEvent, title: '  Workshop  ' }).title,
    ).toBe('Workshop');
  });

  it('rejects a missing required field', () => {
    expect(
      CreateEventSchema.safeParse(without(validEvent, 'timezone')).success,
    ).toBe(false);
  });

  it('allows endsAt and location to be omitted', () => {
    const parsed = CreateEventSchema.parse(
      without(validEvent, 'endsAt', 'location'),
    );

    expect(parsed.endsAt).toBeUndefined();
    expect(parsed.location).toBeUndefined();
  });

  it('rejects endsAt before startsAt', () => {
    const result = CreateEventSchema.safeParse({
      ...validEvent,
      endsAt: '2026-09-01T17:00:00Z',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endsAt']);
  });

  it('allows a zero-length event (endsAt equal to startsAt)', () => {
    expect(
      CreateEventSchema.safeParse({
        ...validEvent,
        endsAt: validEvent.startsAt,
      }).success,
    ).toBe(true);
  });

  it('rejects a local datetime with no offset', () => {
    expect(
      CreateEventSchema.safeParse({
        ...validEvent,
        startsAt: '2026-09-01T18:00:00',
      }).success,
    ).toBe(false);
  });

  it('does not accept an orgId from the body', () => {
    const parsed = CreateEventSchema.parse({
      ...validEvent,
      orgId: 'someone-elses-org',
    });

    expect(parsed).not.toHaveProperty('orgId');
  });
});

describe('UpdateEventSchema', () => {
  it('accepts a single field', () => {
    expect(UpdateEventSchema.parse({ title: 'New title' })).toEqual({
      title: 'New title',
    });
  });

  it('accepts cancelled, unlike create', () => {
    expect(UpdateEventSchema.parse({ status: 'cancelled' }).status).toBe(
      'cancelled',
    );
  });

  it('rejects an empty body', () => {
    const result = UpdateEventSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'At least one field must be provided',
    );
  });

  it('does not inject a default status', () => {
    expect(UpdateEventSchema.parse({ price: 0 })).toEqual({ price: 0 });
  });

  it('still enforces the field rules it is given', () => {
    expect(UpdateEventSchema.safeParse({ price: -5 }).success).toBe(false);
    expect(UpdateEventSchema.safeParse({ maxGuests: -1 }).success).toBe(false);
    expect(UpdateEventSchema.safeParse({ slug: 'Not A Slug' }).success).toBe(
      false,
    );
    expect(UpdateEventSchema.safeParse({ currency: 'usd' }).success).toBe(
      false,
    );
    expect(UpdateEventSchema.safeParse({ timezone: 'Nowhere' }).success).toBe(
      false,
    );
  });

  it('checks endsAt against startsAt when both are present', () => {
    expect(
      UpdateEventSchema.safeParse({
        startsAt: '2026-09-01T18:00:00Z',
        endsAt: '2026-09-01T17:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('skips the ordering check when only one side is present', () => {
    expect(
      UpdateEventSchema.safeParse({ endsAt: '2026-09-01T17:00:00Z' }).success,
    ).toBe(true);
  });

  it('accepts a valid heroImage alongside the imageUrl it describes', () => {
    const parsed = UpdateEventSchema.parse(validUploadedEvent);

    expect(parsed.heroImage).toEqual(validHeroImage);
    expect(parsed.imageUrl).toBe(validUploadedEvent.imageUrl);
  });

  it('rejects heroImage without the imageUrl it is bookkeeping for', () => {
    const result = UpdateEventSchema.safeParse({
      heroImage: validHeroImage,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === 'heroImage')).toBe(
      true,
    );
  });

  it('rejects heroImage when imageUrl is the clear sentinel', () => {
    const result = UpdateEventSchema.safeParse({
      imageUrl: '',
      heroImage: validHeroImage,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === 'heroImage')).toBe(
      true,
    );
  });

  it('accepts an empty imageUrl on its own to clear the image', () => {
    expect(UpdateEventSchema.parse({ imageUrl: '' })).toEqual({
      imageUrl: '',
    });
  });
});
