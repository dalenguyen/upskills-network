import { Component, computed, input } from '@angular/core';
import { Badge, Icon } from '@upskills/ui';

import { formatEventWhen, formatPrice, formatSpots } from './event-format';
import type { PublicEvent } from './event-api';
import { EventImageComponent } from './event-image.component';

/**
 * Everything about the workshop except the form: what it is, when, where, and
 * what it costs.
 *
 * Purely presentational — it takes the API projection and renders it. The two
 * facts a guest decides on (the price and whether spots are left) are pulled
 * out of the body copy and into the header, because a description long enough
 * to be useful is long enough to bury them.
 *
 * A seeded community event replaces both of those with the source's name, for
 * the reason spelled out on {@link EventCardComponent}: its stored price and
 * capacity are placeholders for "not applicable", and rendering them as facts
 * would state a price Upskills neither sets nor collects.
 */
@Component({
  selector: 'app-event-detail',
  imports: [Badge, Icon, EventImageComponent],
  template: `
    <article>
      @if (event().imageUrl) {
        <app-event-image
          [src]="event().imageUrl"
          [alt]="event().title"
          imageClass="mb-8 aspect-[2/1] w-full rounded-2xl object-cover"
        />
      }

      <div class="flex flex-wrap items-center gap-2">
        @if (isExternal()) {
          <ui-badge>via {{ event().sourceName || 'the community' }}</ui-badge>
        } @else {
          <ui-badge>{{ price() }}</ui-badge>

          @if (event().soldOut) {
            <span
              class="inline-flex items-center rounded-full bg-zinc-100 px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200"
            >
              Sold out
            </span>
          } @else if (spots(); as remaining) {
            <span
              class="inline-flex items-center rounded-full bg-amber-50 px-3.5 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-100"
            >
              {{ remaining }}
            </span>
          }
        }
      </div>

      <h1
        class="mt-4 text-3xl font-bold tracking-tight text-balance text-zinc-900 sm:text-4xl"
      >
        {{ event().title }}
      </h1>

      <dl class="mt-6 flex flex-col gap-3 text-sm text-zinc-700">
        <div class="flex items-start gap-3">
          <dt class="mt-0.5 text-zinc-400">
            <ui-icon name="calendar" size="sm" />
            <span class="sr-only">When</span>
          </dt>
          <dd>{{ when() }}</dd>
        </div>

        @if (event().location; as location) {
          <div class="flex items-start gap-3">
            <dt class="mt-0.5 text-zinc-400">
              <ui-icon name="map-pin" size="sm" />
              <span class="sr-only">Where</span>
            </dt>
            <dd>{{ location }}</dd>
          </div>
        }
      </dl>

      <!-- Pre-line whitespace, because the description is plain text typed by
           an organizer: their paragraph breaks are the only structure it has,
           and collapsing them turns a schedule into a wall. It is interpolated,
           never bound as HTML — this is organizer input on a public page. -->
      <div
        class="mt-8 whitespace-pre-line text-base leading-relaxed text-zinc-600"
      >
        {{ event().description }}
      </div>
    </article>
  `,
})
export class EventDetailComponent {
  readonly event = input.required<PublicEvent>();

  /** Listed here, run elsewhere — see the class comment. */
  readonly isExternal = computed(() => Boolean(this.event().externalUrl));

  readonly price = computed(() =>
    formatPrice(this.event().price, this.event().currency),
  );
  readonly when = computed(() =>
    formatEventWhen(
      this.event().startsAt,
      this.event().endsAt,
      this.event().timezone,
    ),
  );
  readonly spots = computed(() => formatSpots(this.event().spotsRemaining));
}
