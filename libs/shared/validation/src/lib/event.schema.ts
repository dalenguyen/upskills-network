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
     * On update only, `''` is a legal value and means "remove the image".
     *
     * Optional-and-absent already means "leave it alone", so without a third
     * spelling there is no way to express removal: an organizer who pasted the
     * wrong URL could overwrite it but never get back to having none. The data
     * layer deletes the key rather than storing the empty string — see
     * `applyOptionalText` in `events-write.ts`.
     */
    imageUrl: z.union([z.literal(''), eventFields.imageUrl.unwrap()]),
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
