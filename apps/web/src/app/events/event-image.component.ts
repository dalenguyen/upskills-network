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
   * Describes the event, not the picture.
   *
   * The image is decoration beside a title that already names the event, so a
   * literal description of the artwork would be noise to a screen reader. The
   * title is what a caller passes, and the aspect ratio class is what a caller
   * varies between the card and the hero.
   */
  readonly alt = input('');

  /** Tailwind classes for the rendered element — the caller owns the sizing. */
  readonly imageClass = input('w-full object-cover');

  private readonly failed = signal(false);

  protected readonly visible = computed(
    () => !this.failed() && (this.src() ?? '').length > 0,
  );

  protected onError(): void {
    this.failed.set(true);
  }
}
