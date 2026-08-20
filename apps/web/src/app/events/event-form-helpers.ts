import { HttpsUrlSchema } from '@upskills/validation';

/**
 * Pure helpers for the event create/edit form, shared by the dashboard pages
 * and the platform-admin console.
 *
 * These used to live on `dashboard/events/new/index.page.ts` and
 * `dashboard/events/[eventId]/edit/index.page.ts`. They are extracted here so
 * the shared {@link EventFormComponent} and both pages import one definition —
 * the same reason the form validates with the server's own `HttpsUrlSchema`
 * rather than a regex of its own.
 */

/** The IANA zones an organizer can schedule an event in. */
export const CANADIAN_TIME_ZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'UTC',
] as const;

/**
 * `2026-09-01T18:00` + `America/Toronto` → `2026-09-01T18:00:00-04:00`.
 *
 * Resolved in two passes. The first reads the wall time as if it were UTC,
 * which is only an approximation: on a DST change day it can land on the wrong
 * side of the transition, so `2026-03-08T03:30` in Toronto — half an hour after
 * the clocks go forward — would be stamped `-05:00` and reload an hour early.
 * The second pass re-reads the offset at the instant the first one implies,
 * which is the offset actually in force at that wall time.
 *
 * A wall time inside the spring-forward gap does not exist in the zone at all.
 * There is no right answer for it; both passes agree on the post-transition
 * offset, which is the same choice `Date` makes.
 */
export function toIsoWithOffset(localValue: string, timeZone: string): string {
  const approximate = offsetAt(new Date(`${localValue}:00Z`), timeZone);
  const offset = offsetAt(new Date(`${localValue}:00${approximate}`), timeZone);

  return `${localValue}:00${offset}`;
}

/** The UTC offset in force in `timeZone` at `instant`, e.g. `-04:00`. */
function offsetAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const name =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);

  return match ? `${match[1]}${match[2]}:${match[3]}` : '+00:00';
}

/** `49.50` → `4950`; `19.99` → `1999` rather than `1998.9999…`. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * `2026-09-10T13:30:00.000Z` + `America/Toronto` → `2026-09-10T09:30`.
 *
 * The wire value is the UTC instant; a `datetime-local` input needs the wall
 * time in the event's own IANA zone. Slicing the first 16 characters would
 * return UTC wall time, which is wrong for every non-UTC zone.
 */
export function toLocalDatetimeValue(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));

  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** `4950` → `"49.50"`; integer cents to the dollars the price input edits. */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Why an optional image URL is checked here as well as on the server.
 *
 * Both buttons on these forms are `type="button"`, so the browser's native
 * constraint validation never runs — and `type="url"` would be too permissive
 * anyway, since it happily accepts `http://`. Without this, pasting a plain
 * `http://` link produces a round trip and a generic 400, which reads as "the
 * save is broken" rather than "fix the protocol".
 *
 * It validates with {@link HttpsUrlSchema} — the same schema
 * `UpdateEventSchema` uses server-side — rather than a regex of its own, so
 * there is exactly one definition of what a legal URL is and the two answers
 * cannot drift. The server check remains authoritative; this one only makes the
 * failure legible sooner.
 *
 * @returns the message to show, or `null` when the value is fine. Empty is
 *   fine: the field is optional, and on the edit form empty means "remove it".
 */
export function imageUrlError(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  return HttpsUrlSchema.safeParse(trimmed).success
    ? null
    : 'Enter an image URL starting with https://, or leave the field empty.';
}
