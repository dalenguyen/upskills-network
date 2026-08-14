import type { Currency, Guest, Timestamp, WorkshopEvent } from '@upskills/models';
import { siteUrl } from './config';

/**
 * Turning stored values into the strings a guest reads, and the links they
 * click.
 *
 * ## Why every date goes through the event's own time zone
 *
 * A workshop happens at a place, at a wall-clock time. The server it is rendered
 * on is in whatever region Cloud Run scheduled it — and the guest's mail client
 * is somewhere else again. Formatting with the process default would mean the
 * same event reads as 6:30 p.m. or 3:30 p.m. depending on which instance
 * happened to send the mail, and a guest arriving three hours late is not a bug
 * anyone finds in review. `WorkshopEvent.timezone` is an IANA name precisely so
 * this is answerable, and every formatter here passes it explicitly. There is no
 * code path in this library that formats a date without one.
 *
 * ## Why the zone label is always printed
 *
 * `6:30 p.m.` is ambiguous to a guest in another province, and workshops are
 * listed publicly. Appending `EDT` costs a few characters and removes the entire
 * class of question. It also makes daylight-saving handling visible: the same
 * event in January and July prints `EST` and `EDT` off the same stored instant,
 * which a fixed UTC offset could never do.
 */

/** Locale for every rendered date and amount. Canadian audience, English copy. */
const LOCALE = 'en-CA';

/**
 * Fallback zone when an event carries a time zone `Intl` will not accept.
 *
 * The validation layer checks `timezone` against `Intl.supportedValuesOf`, so
 * this should be unreachable for anything written through the app. It exists
 * because a hand-edited or restored document must not be able to make a
 * *formatter* throw: this code runs on the send path, after the registration has
 * committed, and an exception there is exactly the "email takes down the
 * transaction" failure the epic forbids. Rendering a UTC time is wrong; failing
 * to render at all is worse.
 */
const FALLBACK_TIMEZONE = 'UTC';

/**
 * The full date and time of an event, in the event's zone.
 *
 * e.g. `Thursday, September 3, 2026 at 6:30 p.m. EDT`.
 */
export function formatEventWhen(event: WorkshopEvent): string {
  return format(event.startsAt, event.timezone, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * A short day label for subject lines, in the event's zone.
 *
 * e.g. `Thursday, September 3`. No time and no year: a subject line is read in a
 * crowded inbox, and the body carries the precise version.
 */
export function formatEventDay(event: WorkshopEvent): string {
  return format(event.startsAt, event.timezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * An amount stored in minor units, as money.
 *
 * e.g. `formatMoney(2500, 'cad')` → `$25.00 CAD`.
 *
 * The `CAD` suffix is not redundant. `en-CA` renders the symbol as a bare `$`,
 * which reads as US dollars to most of the internet, and the difference on a
 * receipt is a support ticket. Prices are stored in cents (Stripe's unit), so
 * the division belongs here rather than at each call site where it could be
 * forgotten on exactly one template.
 */
export function formatMoney(minorUnits: number, currency: Currency): string {
  const code = currency.toUpperCase();

  const amount = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
  }).format(minorUnits / 100);

  return `${amount} ${code}`;
}

/** An event's price, or `Free` when there is nothing to pay. */
export function formatPrice(event: WorkshopEvent): string {
  return event.price > 0 ? formatMoney(event.price, event.currency) : 'Free';
}

/** Public path of the self-cancel page. Exported so the page and the emails agree. */
export const CANCEL_PATH = '/r/cancel';

/**
 * The guest's personal cancel link.
 *
 * Every guest-facing email that leaves a registration standing carries this, and
 * it is the only thing that lets a guest release a spot without an account.
 *
 * ## Why it carries the token, and why the address is the *normalized* one
 *
 * The cancel endpoint takes an email and a `cancelToken` and accepts neither
 * alone — email alone would let anyone cancel a stranger's spot by guessing an
 * address, which is the whole reason the token exists. The token is random and
 * per-guest, so a link is only ever good for the one registration it was mailed
 * about.
 *
 * The address in the link is `guestId`, not `email`: `guestId` *is* the
 * normalized address and *is* the document id the endpoint will look up. Putting
 * the display-cased `email` in the link would work only as long as nothing
 * downstream compared the two, and would fail for the first guest who typed
 * `Name@Example.com`.
 */
export function cancelUrl(guest: Guest): string {
  const query = new URLSearchParams({
    event: guest.eventId,
    email: guest.guestId,
    token: guest.cancelToken,
  });

  return `${siteUrl()}${CANCEL_PATH}?${query.toString()}`;
}

/** The public event page. */
export function eventUrl(event: WorkshopEvent): string {
  return `${siteUrl()}/events/${encodeURIComponent(event.slug)}`;
}

/** The organizer-facing guest list for an event. */
export function guestListUrl(event: WorkshopEvent): string {
  return `${siteUrl()}/dashboard/events/${encodeURIComponent(
    event.eventId,
  )}/guests`;
}

/**
 * A guest's first name, for a greeting.
 *
 * Falls back to the whole stored name, and then to a neutral greeting, because
 * `name` is free text a guest typed: it can be one word, three words, or —
 * whatever validation lets through — blank. "Hi ," is the kind of small
 * wrongness that makes a transactional email look fraudulent.
 */
export function greetingName(guest: Guest): string {
  const first = guest.name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'there';
}

/**
 * Format one timestamp in one zone, degrading to UTC rather than throwing.
 *
 * `Intl.DateTimeFormat` raises `RangeError` on a time zone it does not know, and
 * this runs after the commit — see {@link FALLBACK_TIMEZONE}.
 */
function format(
  at: Timestamp,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = at.toDate();

  try {
    return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: timezone })
      .format(date);
  } catch {
    return new Intl.DateTimeFormat(LOCALE, {
      ...options,
      timeZone: FALLBACK_TIMEZONE,
    }).format(date);
  }
}
