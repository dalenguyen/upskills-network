import type {
  Currency,
  EventStatus,
  GuestStatus,
  OrgRole,
} from '@upskills/models';
import { z } from 'zod';
import { normalizeEmail } from './normalize-email';
import { isReservedSlug } from './slugify';

/**
 * Email, normalized *then* validated.
 *
 * The transform runs first so `' Foo@Bar.COM '` is accepted and comes out as
 * `'foo@bar.com'` — the exact string used as the guest doc id. It calls
 * {@link normalizeEmail} rather than repeating `.trim().toLowerCase()` inline,
 * so there is only one normalization rule in the codebase.
 */
export const EmailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Invalid email address' }));

/** Non-empty, trimmed identifier (uid, orgId, eventId, …). */
export const IdSchema = z.string().trim().min(1);

/**
 * URL slug. Lowercase letters, digits and hyphens only — the same charset the
 * `orgSlugs/{slug}` and `eventSlugs/{slug}` reservation docs are keyed by, so a
 * validated slug is always a legal Firestore document id.
 */
export const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/, {
    message: 'Slug may only contain lowercase letters, numbers and hyphens',
  });

/**
 * An **organizer** slug: a legal slug that is also not a reserved word.
 *
 * Organizer slugs are top-level URL segments (`/{orgSlug}`,
 * `/{orgSlug}/{eventSlug}`), so they share a namespace with every static route
 * in the app. `RESERVED_SLUGS` in `slugify.ts` is where that list lives and why.
 *
 * Event slugs keep using the plain {@link SlugSchema}: they are only ever the
 * second segment, under an organizer that has already been resolved, so there is
 * no route for them to shadow.
 */
export const OrgSlugSchema = SlugSchema.refine(
  (slug) => !isReservedSlug(slug),
  {
    message: 'That slug is reserved. Choose a different one.',
  },
);

/**
 * Absolute `https:` URL, for values that end up in an `href` or an `<img src>`
 * on a public page.
 *
 * `https:` only, checked by parsing rather than by pattern. `z.url()` alone
 * accepts any scheme the URL parser does, which includes `javascript:` and
 * `data:` — both of which become script execution the moment the string is
 * bound to an anchor. Plain `http:` is rejected too: the site is served over
 * TLS, and a mixed-content image silently fails to load anyway.
 *
 * The 2000-character cap is the practical URL limit browsers and Firestore
 * indexes agree on, and it stops a pasted data URI from being stored whole.
 */
export const HttpsUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(
    z.url({
      protocol: /^https$/,
      message: 'Enter an https:// URL',
    }),
  );

/** Price in **minor units** (cents). `0` is free; negatives are never valid. */
export const PriceSchema = z
  .number()
  .int({ message: 'Price must be an integer number of cents' })
  .min(0);

/** CAD only for now — kept as a field so more currencies are additive. */
export const CurrencySchema = z.literal('cad') satisfies z.ZodType<Currency>;

/** Capacity. `0` means unlimited; negative is rejected. */
export const MaxGuestsSchema = z
  .number()
  .int({ message: 'maxGuests must be a whole number' })
  .min(0);

/**
 * Set of IANA zone names this runtime knows about. Built once — the list is
 * ~400 entries and never changes within a process.
 *
 * `'UTC'` is added explicitly: `Intl.supportedValuesOf('timeZone')` returns only
 * *canonical* zones and omits UTC on some runtimes (Node 22 does), yet every
 * `Intl.DateTimeFormat` accepts it and it is the obvious choice for an online
 * event. Everything else stays as the runtime reports it, so deprecated aliases
 * like `'US/Eastern'` are still rejected in favour of their canonical name.
 */
const SUPPORTED_TIME_ZONES = new Set([
  ...Intl.supportedValuesOf('timeZone'),
  'UTC',
]);

/**
 * IANA time zone name, e.g. `'America/Toronto'`. Validated against the
 * runtime's own zone list rather than a regex, so `'Mars/Olympus'` and raw
 * offsets like `'-04:00'` are rejected — reminders schedule off this value.
 */
export const TimezoneSchema = z
  .string()
  .trim()
  .refine((value) => SUPPORTED_TIME_ZONES.has(value), {
    message: 'Unknown IANA time zone',
  });

/**
 * ISO-8601 instant with an explicit UTC designator or offset
 * (`2026-09-01T18:00:00Z`, `2026-09-01T18:00:00-04:00`). A local time without
 * an offset is rejected: pairing it with `timezone` would make the instant
 * ambiguous across DST.
 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Token embedded in cancellation links. Only checked for presence here —
 * generation and comparison live in the server route that issues it.
 */
export const CancelTokenSchema = z.string().trim().min(1);

const ORG_ROLES = [
  'admin',
  'manager',
  'check_in',
  'volunteer',
] as const satisfies readonly OrgRole[];

/** Role within a single organizer. */
export const OrgRoleSchema = z.enum(ORG_ROLES);

const EVENT_STATUSES = [
  'draft',
  'published',
  'cancelled',
] as const satisfies readonly EventStatus[];

/** Full event lifecycle, including `cancelled`. */
export const EventStatusSchema = z.enum(EVENT_STATUSES);

const GUEST_STATUSES = [
  'confirmed',
  'held',
  'pending',
  'cancelled',
  'expired',
] as const satisfies readonly GuestStatus[];

/** Registration state. */
export const GuestStatusSchema = z.enum(GUEST_STATUSES);
