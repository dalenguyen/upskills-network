import type { Currency } from '@upskills/models';

/**
 * Presentation helpers for the public event page.
 *
 * They live apart from the components for one reason: every one of them is a
 * pure function of the API projection, so they can be tested against awkward
 * inputs — an unparseable date, an over-subscribed counter — without mounting
 * a component to do it.
 */

/** Below this, the remaining count is worth showing; above it, it is noise. */
const SCARCITY_THRESHOLD = 10;

/**
 * A price as a guest reads it.
 *
 * `price` is minor units, so it is divided before formatting. Zero is rendered
 * as the word "Free" rather than "CA$0.00": the two mean the same thing, but
 * only one of them reads like a deliberate choice by the organizer.
 */
export function formatPrice(price: number, currency: Currency): string {
  if (price === 0) {
    return 'Free';
  }

  const amount = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
  }).format(price / 100);

  // The code is appended rather than left to `currencyDisplay: 'code'`, which
  // en-CA renders as "CAD 45.00". "$45.00" alone is the ambiguous case worth
  // avoiding: a Canadian dollar sign is indistinguishable from a US one, and
  // the guest is about to be charged.
  return `${amount} ${currency.toUpperCase()}`;
}

/**
 * When the workshop happens, in the *organizer's* timezone.
 *
 * Deliberately not the viewer's. An in-person workshop happens at a place, and
 * the time that matters is the local time at that place — a guest in Vancouver
 * reading "9:30 a.m." for a Toronto workshop and mentally converting is doing
 * the right work, whereas one shown "6:30 a.m." in their own zone has to work
 * out that the number is not what will be printed on the door.
 *
 * The zone abbreviation is always included so the number is never ambiguous.
 *
 * ## When the time is unknown
 *
 * A curated listing sometimes gives a date and no time of day. `startsAt` still
 * holds an instant — it is what the event sorts by — but that hour is a
 * placeholder, and printing it would state a fact nobody published. With
 * `startTimeTbd` the date is rendered alone, followed by "time TBA", so the
 * page says what it knows and says that it does not know the rest.
 */
export function formatEventWhen(
  startsAt: string,
  endsAt: string | undefined,
  timezone: string,
  startTimeTbd = false,
): string {
  const start = new Date(startsAt);

  if (Number.isNaN(start.getTime())) {
    // A malformed timestamp is a data problem, not a reason to render
    // "Invalid Date" at the top of the page that is meant to convert.
    return startsAt;
  }

  const date = intlFormat(start, timezone, {
    dateStyle: 'long',
  });

  if (startTimeTbd) {
    return `${date} · time TBA`;
  }
  const startTime = intlFormat(start, timezone, {
    timeStyle: 'short',
  });
  const zone = intlFormat(start, timezone, {
    timeZoneName: 'short',
  })
    .split(', ')
    .pop();

  const end = endsAt === undefined ? null : new Date(endsAt);
  const endTime =
    end === null || Number.isNaN(end.getTime())
      ? null
      : intlFormat(end, timezone, { timeStyle: 'short' });

  const times = endTime === null ? startTime : `${startTime} – ${endTime}`;

  return `${date} · ${times} ${zone ?? ''}`.trim();
}

/**
 * "3/10 spots left", or nothing at all.
 *
 * Nothing is the right answer more often than a number is. Unlimited capacity
 * has no count to give; a comfortable count ("40/50 spots left") tells a guest
 * they can safely close the tab; and zero is already being said, far more
 * clearly, by the sold-out state that replaces the button.
 *
 * The total is shown alongside the remaining count — "3/10", not just "3" —
 * so scarcity reads as a fraction of the room rather than an unexplained
 * number a guest has no way to size up.
 */
export function formatSpots(
  spotsRemaining: number | null,
  maxGuests: number,
): string | null {
  if (
    spotsRemaining === null ||
    spotsRemaining === 0 ||
    spotsRemaining > SCARCITY_THRESHOLD
  ) {
    return null;
  }

  return spotsRemaining === 1
    ? `1/${maxGuests} spot left`
    : `${spotsRemaining}/${maxGuests} spots left`;
}

function intlFormat(
  value: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).format(
      value,
    );
  } catch {
    // An unknown IANA zone throws a RangeError. Rendering the UTC instant is a
    // worse answer than the local one, but it is still a readable answer.
    return new Intl.DateTimeFormat('en-CA', options).format(value);
  }
}
