import { Component, computed, input } from '@angular/core';
import { Badge, Card, Icon } from '@upskills/ui';

import {
  formatEventWhen,
  formatLocationUrl,
  formatPrice,
  formatSpots,
} from './event-format';
import { eventPath, type PublicEvent } from './event-api';
import { EventImageComponent } from './event-image.component';

/**
 * One event on the public browse page.
 *
 * A summary, not the detail: title, when, where, and the two facts a guest
 * decides on (price, availability). The whole card is a link to the event's own
 * page, where the description and the registration form live. Purely
 * presentational — the same `event-format` helpers as {@link EventDetailComponent}.
 *
 * ## Seeded community events look different on purpose
 *
 * An event with an `externalUrl` is one Upskills lists rather than runs, and
 * two things change for it. It carries a "via Meetup" badge, so a visitor knows
 * before clicking whose event it is. And it shows **no price**, because a
 * listed event stores `price: 0` as "not applicable" — rendering that as "Free"
 * would advertise a price Upskills does not set and cannot honour, on an event
 * the source may well charge for. Capacity is suppressed for the same reason:
 * the seat count lives wherever the registrations do.
 *
 * The card still links to the event's own page here, not straight out. That
 * page carries the description and names the destination before handing the
 * visitor over.
 */
@Component({
  selector: 'app-event-card',
  imports: [Badge, Card, Icon, EventImageComponent],
  template: `
    <ui-card>
      <div class="relative flex h-full flex-col p-6">
        <!-- Unconditional: an event with no image gets a coloured block bearing
             its initials, so every card in the list has the same shape. No alt
             either way — the title is a heading three lines below, so the image
             adds nothing a screen reader has not already been given. -->
        <app-event-image
          [src]="event().imageUrl"
          [title]="event().title"
          [seed]="event().slug"
          imageClass="mb-5 -mx-6 -mt-6 aspect-video w-[calc(100%+3rem)] max-w-none object-cover"
        />

        <div class="flex items-center justify-between gap-3">
          @if (isExternal()) {
            <ui-badge>via {{ event().sourceName || 'the community' }}</ui-badge>
          } @else {
            <ui-badge>{{ price() }}</ui-badge>
          }

          <!-- Capacity is suppressed on a listed event: the seat count lives
               wherever the registrations do, and this one has none. -->
          @if (!isExternal()) {
            @if (event().soldOut) {
              <span
                class="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200"
              >
                Sold out
              </span>
            } @else if (spots(); as remaining) {
              <span
                class="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-100"
              >
                {{ remaining }}
              </span>
            }
          }
        </div>

        <h2 class="mt-5 text-lg font-semibold text-zinc-900">
          <a
            [href]="eventPath(event())"
            class="after:absolute after:inset-0 after:content-['']"
          >
            {{ event().title }}
          </a>
        </h2>

        <dl class="mt-auto flex flex-col gap-2.5 pt-5 text-sm text-zinc-600">
          <div class="flex items-start gap-2.5">
            <dt class="mt-0.5 text-zinc-400">
              <ui-icon name="calendar" size="sm" />
              <span class="sr-only">When</span>
            </dt>
            <dd>{{ when() }}</dd>
          </div>

          @if (event().location?.trim(); as location) {
            <div class="flex items-start gap-2.5">
              <dt class="mt-0.5 text-zinc-400">
                <ui-icon name="map-pin" size="sm" />
                <span class="sr-only">Where</span>
              </dt>
              <dd>
                <a
                  [href]="formatLocationUrl(location)"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  class="relative z-10 font-medium text-indigo-600 transition hover:text-indigo-500"
                >
                  {{ location }}
                </a>
              </dd>
            </div>
          }
        </dl>

        <span
          class="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600"
        >
          View details
          <ui-icon name="arrow-right" size="sm" />
        </span>
      </div>
    </ui-card>
  `,
})
export class EventCardComponent {
  readonly event = input.required<PublicEvent>();

  /**
   * `/{orgSlug}/{eventSlug}` — built here rather than concatenated in the
   * template, so the two segments are escaped exactly once and the browse
   * listing cannot produce a link that disagrees with the router.
   */
  protected readonly eventPath = eventPath;

  /** Listed here, run elsewhere — see the class comment. */
  protected readonly formatLocationUrl = formatLocationUrl;

  readonly isExternal = computed(() => Boolean(this.event().externalUrl));

  readonly price = computed(() =>
    formatPrice(this.event().price, this.event().currency),
  );
  readonly when = computed(() =>
    formatEventWhen(
      this.event().startsAt,
      this.event().endsAt,
      this.event().timezone,
      this.event().startTimeTbd,
    ),
  );
  readonly spots = computed(() =>
    formatSpots(this.event().spotsRemaining, this.event().maxGuests),
  );
}
