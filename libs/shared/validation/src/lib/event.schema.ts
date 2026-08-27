import { z } from 'zod';
import {
  CurrencySchema,
  EventStatusSchema,
  HttpsUrlSchema,
  IsoDateTimeSchema,
  MaxGuestsSchema,
  PriceSchema,
  SlugSchema,
  TimezoneSchema,
} from './primitives';

/**
 * Storage bookkeeping for an uploaded event hero image.
 *
 * Mirrors the shape of `HeroImage` on `WorkshopEvent`. The uploaded bytes are
 * already constrained by the upload route before a save ever runs; this schema
 * keeps the stored record just as tight so a malformed write cannot be handed
 * to the rest of the app.
 */
export const HeroImageSchema = z.object({
  /** Non-empty storage object path. */
  storagePath: z.string().trim().min(1),
  /** MIME type the upload route accepted. */
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Size of the uploaded bytes; the upload route rejects anything over 5 MB. */
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  /** ISO-8601 instant with an offset, recorded when the upload completed. */
  uploadedAt: IsoDateTimeSchema,
});

/**
 * Body fields for creating an event.
 *
 * `orgId` and `eventId` are deliberately absent: they come from the route path
 * and the authenticated session, never from the client body — the same reason
 * {@link CancelGuestSchema} carries only `email` + `cancelToken`.
 */
const eventFields = {
  title: z.string().trim().min(1).max(200),
  slug: SlugSchema,
  description: z.string().trim().max(5000),
  /** ISO-8601 with offset; converted to a `Timestamp` by the data-access lib. */
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema.optional(),
  timezone: TimezoneSchema,
  location: z.string().trim().max(300).optional(),
  /**
   * Hero image URL. Present here, and so editable from the dashboard, because
   * an image is something every organizer wants for their own events.
   *
   * `externalUrl` and `sourceName` are deliberately **not** in this object.
   * Marking an event as "listed elsewhere, register over there" is a curation
   * decision, and the seed script is the only path to it — a dashboard form
   * that could set `externalUrl` would let an organizer publish an event on
   * Upskills that silently refuses every registration.
   */
  imageUrl: HttpsUrlSchema.optional(),
  price: PriceSchema,
  currency: CurrencySchema,
  maxGuests: MaxGuestsSchema,
};

/** `endsAt`, when given, must not precede `startsAt`. */
function endsAfterStart(
  value: { startsAt?: string; endsAt?: string },
  ctx: z.RefinementCtx,
): void {
  if (!value.startsAt || !value.endsAt) return;
  if (Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must be at or after startsAt',
    });
  }
}

export const CreateEventSchema = z
  .object({
    ...eventFields,
    /**
     * Bookkeeping for an image uploaded before the event was saved. Optional,
     * like `imageUrl`; when it is present the two fields were written together.
     */
    heroImage: HeroImageSchema.optional(),
    /** New events default to `draft`; `cancelled` is not a creation state. */
    status: z.enum(['draft', 'published']).default('draft'),
  })
  .superRefine(endsAfterStart);

/**
 * Partial update. Every field optional, but at least one must be present so an
 * empty body cannot bump `updatedAt` for nothing. `orgId` is not updatable —
 * an event never moves between organizers.
 */
export const UpdateEventSchema = z
  .object({
    ...eventFields,
    /**
     * On update, `''` is a legal value for the optional text fields and means
     * "remove this".
     *
     * A patch has three states where a create has two. Absent means "leave it
     * alone", a value means "set it", and without a third spelling there is no
     * way to say "clear it" — an organizer who pasted the wrong image URL could
     * overwrite it but never get back to having none, and an event that moved
     * online would keep its old address forever. The data layer deletes the key
     * rather than storing the empty string; see `applyOptionalText` in
     * `events-write.ts`.
     *
     * `location` is spelled out here even though `eventFields.location` happens
     * to admit `''` already, because it does so only by not having a `.min(1)`
     * — an accident that the next person tightening the field would remove
     * without ever learning it was load-bearing.
     */
    imageUrl: z.union([z.literal(''), eventFields.imageUrl.unwrap()]),
    location: z.union([z.literal(''), eventFields.location.unwrap()]),
    status: EventStatusSchema,
  })
  .partial()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one field must be provided',
      });
    }
    endsAfterStart(value, ctx);
  });

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;
