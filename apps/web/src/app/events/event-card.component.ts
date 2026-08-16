import { Component, computed, input } from '@angular/core';
import { Badge, Card, Icon } from '@upskills/ui';

import { formatEventWhen, formatPrice, formatSpots } from './event-format';
import type { PublicEvent } from './event-api';

/**
 * One event on the public browse page.
 *
 * A summary, not the detail: title, when, where, and the two facts a guest
 * decides on (price, availability). The whole card is a link to the event's own
 * page, where the description and the registration form live. Purely
 * presentational — the same `event-format` helpers as {@link EventDetailComponent}.
 */
@Component({
  selector: 'app-event-card',
  imports: [Badge, Card, Icon],
  template: `
    <ui-card>
      <a
        [href]="'/events/' + event().slug"
        class="flex h-full flex-col gap-5 p-6"
      >
        <div class="flex items-center justify-between gap-3">
          <ui-badge>{{ price() }}</ui-badge>

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
        </div>

        <h2 class="text-lg font-semibold text-zinc-900">{{ event().title }}</h2>

        <dl class="mt-auto flex flex-col gap-2.5 text-sm text-zinc-600">
          <div class="flex items-start gap-2.5">
            <dt class="mt-0.5 text-zinc-400">
              <ui-icon name="calendar" size="sm" />
              <span class="sr-only">When</span>
            </dt>
            <dd>{{ when() }}</dd>
          </div>

          @if (event().location; as location) {
            <div class="flex items-start gap-2.5">
              <dt class="mt-0.5 text-zinc-400">
                <ui-icon name="map-pin" size="sm" />
                <span class="sr-only">Where</span>
              </dt>
              <dd>{{ location }}</dd>
            </div>
          }
        </dl>

        <span
          class="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600"
        >
          View details
          <ui-icon name="arrow-right" size="sm" />
        </span>
      </a>
    </ui-card>
  `,
})
export class EventCardComponent {
  readonly event = input.required<PublicEvent>();

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
