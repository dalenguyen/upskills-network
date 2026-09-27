/**
 * When a published event stops being "upcoming".
 *
 * ## Why a grace window, and why it hangs off `startsAt`
 *
 * An event that vanished from the listing the minute it started would strand
 * the guest running ten minutes late, who opens `/events` to find the address.
 * Three hours covers the length of a typical workshop.
 *
 * The cut is measured from `startsAt` rather than `endsAt` because `endsAt` is
 * optional, and because the public listing is a Firestore query: a range filter
 * has to be on the field the query orders by, and the listing orders by
 * `startsAt`. Filtering on `endsAt` would need a second sort key and a new
 * composite index for a difference nobody would notice.
 *
 * The server query and the event page both use this one definition, so an
 * event is never in the upcoming list while its page says it has ended.
 */
export const UPCOMING_GRACE_MS = 3 * 60 * 60 * 1000;

/** Which side of the cut a public listing reads. */
export type EventTimeframe = 'upcoming' | 'past';

/**
 * The instant that splits upcoming from past: an event starting at or after it
 * is upcoming, one starting before it is past.
 */
export function upcomingCutoff(now: Date): Date {
  return new Date(now.getTime() - UPCOMING_GRACE_MS);
}

/** `true` once an event starting at `startsAt` has left the upcoming list. */
export function isPastEvent(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() < upcomingCutoff(now).getTime();
}
