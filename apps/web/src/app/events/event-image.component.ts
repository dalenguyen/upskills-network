import { Component, computed, input, signal } from '@angular/core';

/**
 * An event's hero image — the real one when there is one, a generated stand-in
 * when there is not.
 *
 * ## Why every event gets something
 *
 * Most events carry no `imageUrl`. Nobody uploads one on the create form, and
 * the curated community listings are seeded from a JSON file that records a URL
 * only when the source publishes a usable one. Rendering nothing in that case
 * left the browse page a wall of text cards, and made the handful of events that
 * *did* have a picture look like a different feature rather than the same card
 * with more in it.
 *
 * So the fallback is a coloured block bearing the event's initials. It states
 * nothing — it is not a photograph of a room nobody has seen, not a stock image
 * of a conference that is not this conference, and not a grey "no image"
 * apology. It gives the card a shape and a colour to be recognised by, and it is
 * honest about being decoration.
 *
 * ## Why the colour is derived, not stored
 *
 * The block's colour comes from hashing {@link seed}, so an event keeps the same
 * one on every render, in every list, on the server and in the browser alike.
 * Storing a colour on the document would be a field to migrate, to validate, and
 * to leave wrong when an event is re-seeded. A pure function of a value the
 * event already has costs nothing and cannot drift.
 *
 * The palette is a fixed array of literal class strings because Tailwind v4
 * finds classes by scanning source text: a template that built
 * `from-${colour}-500` would compile and then render unstyled, since no such
 * string ever appears for the scanner to find.
 *
 * ## Why a failed image lands here too
 *
 * Event images are remote URLs — for seeded community events, someone else's
 * CDN. Those rot: a listing is edited, a bucket is made private, a host starts
 * refusing cross-origin loads. This used to remove the element entirely on
 * failure, which fixed the broken-image glyph but collapsed the card mid-scroll.
 * Falling back to the stand-in keeps the layout it already reserved, and makes
 * an event whose image broke indistinguishable from one that never had a
 * picture — which is the honest answer in both cases.
 *
 * `referrerpolicy="no-referrer"` is what makes the cross-origin case work at
 * all: several event hosts serve an image only when the `Referer` is their own
 * page, and sending none is treated more permissively than sending a stranger's
 * domain. It also stops every card on the browse page from telling a third
 * party which Upskills URL the visitor is reading.
 */
@Component({
  selector: 'app-event-image',
  imports: [],
  template: `
    @if (showImage()) {
      <img
        [src]="src()"
        [alt]="alt()"
        [class]="imageClass()"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        (error)="onError()"
      />
    } @else {
      <!-- aria-hidden: pure decoration standing in for a picture that does not
           exist. The initials are the title's, and the title is a heading
           beside this block — announcing them would be reading it twice. -->
      <div
        [class]="placeholderClass()"
        aria-hidden="true"
        data-testid="event-image-placeholder"
      >
        <span
          class="text-4xl font-bold tracking-tight text-white/90 sm:text-5xl"
        >
          {{ initials() }}
        </span>
      </div>
    }
  `,
})
export class EventImageComponent {
  /** Absolute https URL, or `undefined` when the event has no image. */
  readonly src = input<string | undefined>(undefined);

  /**
   * Alternative text. Defaults to empty, which is the right answer here.
   *
   * Both callers render the event's title as a heading immediately beside this
   * image, so the image carries no information the page does not already state
   * in text — it is decorative. Giving it the title as `alt` would make a
   * screen reader announce the same words twice, once as an image and once as
   * the heading. An empty `alt` is what tells assistive technology to skip it.
   *
   * Pass a real description only if an image ever appears without its title
   * next to it.
   */
  readonly alt = input('');

  /** Tailwind classes for the rendered element — the caller owns the sizing. */
  readonly imageClass = input('w-full object-cover');

  /**
   * The event's title, which the stand-in reduces to initials.
   *
   * Unused when a real image loads.
   */
  readonly title = input('');

  /**
   * What the stand-in's colour is derived from — pass the event's slug.
   *
   * The slug rather than the title because it is the event's identity: editing
   * a title in the seed file corrects the wording of an event people may have
   * already seen, and there is no reason for that to also repaint it.
   */
  readonly seed = input('');

  /**
   * The `src` that failed, not a "has failed" flag.
   *
   * Angular reuses a component instance when the data behind it changes — the
   * browse list re-renders its cards from a new page of events without
   * rebuilding the DOM. A boolean would make the first broken image poison the
   * instance for good: every later event routed through it would fall back to
   * its initials without the browser ever requesting its perfectly valid image.
   * Recording *which* URL failed scopes the failure to the URL that earned it.
   */
  private readonly failedSrc = signal<string | undefined>(undefined);

  protected readonly showImage = computed(() => {
    const src = this.src();
    return src !== undefined && src.length > 0 && this.failedSrc() !== src;
  });

  protected readonly placeholderClass = computed(
    () =>
      `${this.imageClass()} flex items-center justify-center bg-gradient-to-br ${gradientFor(this.seed())}`,
  );

  protected readonly initials = computed(() => initialsOf(this.title()));

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}

/**
 * Stand-in colours.
 *
 * Written out in full — see the class comment on why a template cannot build
 * these strings. Every entry is dark enough for white text to clear WCAG AA at
 * the size the initials render, which is what makes the monogram legible rather
 * than merely present.
 */
const GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-fuchsia-600',
] as const;

/**
 * Pick a stable gradient for a string.
 *
 * FNV-1a, because it is four lines and needs no dependency. This chooses a
 * colour for a decorative block — it is not a checksum and nothing depends on
 * it being hard to collide.
 */
function gradientFor(seed: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // The 32-bit FNV prime, as shifts: `hash * 16777619` overflows a JS number
    // into precision loss long before it wraps.
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

/**
 * Up to two initials from a title, for the stand-in.
 *
 * Splits on whitespace and keeps the first character of the first two words
 * that start with a letter or digit, so `'M365 Toronto 2026'` gives `'MT'` and
 * `'— Elevate Festival'` gives `'EF'` rather than a dash. Falls back to a
 * bullet, which reads as "no title" instead of rendering an empty box that
 * looks like a layout bug.
 */
function initialsOf(title: string): string {
  const letters = title
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter((character) => character !== '')
    .slice(0, 2)
    .join('');

  return letters === '' ? '•' : letters.toUpperCase();
}
