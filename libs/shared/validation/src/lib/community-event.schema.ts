import { z } from 'zod';
import {
  HttpsUrlSchema,
  IsoDateTimeSchema,
  SlugSchema,
  TimezoneSchema,
} from './primitives';

/**
 * One row of the curated community-events file.
 *
 * These are events happening elsewhere — a Meetup, an Eventbrite listing, a
 * conference — that Upskills lists so its events page is worth reading before
 * enough organizers have joined to fill it themselves. They are seeded by a
 * script from a checked-in JSON file, never through a form.
 *
 * ## Why this is not `CreateEventSchema`
 *
 * A seeded event describes something the platform does not run. Three fields
 * that a real event needs are meaningless here and are therefore absent rather
 * than optional: `price` and `currency` (whatever the source charges is the
 * source's business, and quoting it here would go stale silently), and
 * `maxGuests` (capacity belongs to whoever takes the registrations). The seed
 * script fills all three with the "not applicable" values — free, CAD,
 * unlimited — which is honest only because {@link externalUrl} makes the
 * registration path refuse outright.
 *
 * `status` is absent for the same reason: a curated listing that is not
 * published is just a row you should have deleted from the file.
 */
export const CommunityEventSeedSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /**
   * Stable identity of the row, not just a URL segment.
   *
   * Re-running the seed matches on this: a slug that already resolves under the
   * org is updated in place, anything else is created. Editing a title in the
   * JSON therefore corrects the existing event; editing the *slug* creates a
   * second one and orphans the first.
   */
  slug: SlugSchema,
  description: z.string().trim().max(5000),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema.optional(),
  /**
   * Set when the source publishes a date but no time of day.
   *
   * `startsAt` still needs a value — it is what the event sorts by — so pick
   * any hour on the right local date and set this. The public pages then render
   * the date alone, and the placeholder hour is never shown to anyone.
   */
  startTimeTbd: z.boolean().optional(),
  timezone: TimezoneSchema,
  location: z.string().trim().max(300).optional(),
  /** Required — an event with nowhere to send people is not worth listing. */
  externalUrl: HttpsUrlSchema,
  /** Required, so every seeded card can name whose listing it is. */
  sourceName: z.string().trim().min(1).max(60),
  imageUrl: HttpsUrlSchema.optional(),
});

/** `endsAt`, when given, must not precede `startsAt`. */
export const CommunityEventSeedRowSchema = CommunityEventSeedSchema.superRefine(
  (value, ctx) => {
    if (value.endsAt && Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must be at or after startsAt',
      });
    }
  },
);

/** The whole file: a bare array of rows. */
export const CommunityEventSeedFileSchema = z.array(
  CommunityEventSeedRowSchema,
);

export type CommunityEventSeed = z.infer<typeof CommunityEventSeedRowSchema>;
