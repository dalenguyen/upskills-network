import { Component, computed, input, signal } from '@angular/core';

/**
 * An event's hero image, or nothing at all.
 *
 * ## Why this is a component and not an `<img>` in two templates
 *
 * Event images are remote URLs — for seeded community events, someone else's
 * CDN. Those rot: a Meetup listing is edited, a bucket is made private, a host
 * starts refusing cross-origin loads. A bare `<img>` failing that way leaves a
 * broken-image glyph and the alt text sitting in the layout, which reads as a
 * bug in the page rather than as an event without a picture.
 *
 * So the load failure is caught and the element is removed. An event with no
 * image and an event whose image would not load render identically, which is
 * the honest answer in both cases. The card and the detail page share the
 * behaviour rather than each remembering to implement it.
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
    @if (visible()) {
      <img
        [src]="src()"
        [alt]="alt()"
        [class]="imageClass()"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        (error)="onError()"
      />
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
   * The `src` that failed, not a "has failed" flag.
   *
   * Angular reuses a component instance when the data behind it changes — the
   * browse list re-renders its cards from a new page of events without
   * rebuilding the DOM. A boolean would make the first broken image poison the
   * instance for good: every later event routed through it would be hidden
   * without the browser ever requesting its perfectly valid image. Recording
   * *which* URL failed scopes the failure to the URL that earned it.
   */
  private readonly failedSrc = signal<string | undefined>(undefined);

  protected readonly visible = computed(() => {
    const src = this.src();
    return src !== undefined && src.length > 0 && this.failedSrc() !== src;
  });

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
