import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import {
  eventsEndpoint,
  type EventsListResponse,
  type PublicEvent,
} from '../../events/event-api';
import { EventCardComponent } from '../../events/event-card.component';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

/**
 * `/events` — the public browse page: every published workshop, soonest first.
 *
 * The fetch runs in `ngOnInit` for the same reason as the event detail page:
 * SSR waits for it, renders the finished list, and the hydration transfer cache
 * replays the response in the browser instead of issuing a second request.
 *
 * "Load more" pages with the cursor the API hands back rather than an offset.
 * An offset would shift under the reader as events are published mid-browse; the
 * cursor addresses a fixed `(startsAt, eventId)` position, so pages stay
 * disjoint no matter what changes between requests.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      events: PublicEvent[];
      nextCursor: string | null;
    };

@Component({
  selector: 'app-events-page',
  imports: [EventCardComponent, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        <div class="mx-auto max-w-2xl text-center">
          <p
            class="text-xs font-semibold uppercase tracking-widest text-indigo-600"
          >
            Upcoming workshops
          </p>
          <h1
            class="mt-3 text-balance text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
          >
            Events
          </h1>
          <p class="mt-4 text-pretty text-lg leading-8 text-zinc-600">
            In-person workshops where you learn from practitioners and meet
            peers — no lectures, no passive webinars.
          </p>
        </div>

        @switch (state().status) {
          @case ('loading') {
            <p class="mt-12 text-sm text-zinc-500" role="status">
              Loading events…
            </p>
          }

          @case ('error') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h2 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h2>
              <p class="mt-3 text-zinc-600">
                We couldn't load the events. Please try again.
              </p>
              <button
                type="button"
                (click)="tryAgain()"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Try again
              </button>
            </section>
          }

          @case ('ready') {
            @if (events().length === 0) {
              <section
                class="mt-12 rounded-xl border border-dashed border-zinc-300 py-16 text-center"
              >
                <h2 class="text-lg font-semibold text-zinc-900">
                  No events yet
                </h2>
                <p class="mt-2 text-sm text-zinc-600">
                  Workshops are on the way. Join the waitlist to hear first.
                </p>
                <a
                  href="/#waitlist"
                  class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Join the waitlist
                </a>
              </section>
            } @else {
              <div
                class="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
              >
                @for (event of events(); track event.eventId) {
                  <app-event-card [event]="event" />
                }
              </div>

              @if (nextCursor(); as cursor) {
                <div class="mt-12 text-center">
                  <button
                    type="button"
                    [disabled]="loadingMore()"
                    (click)="loadMore()"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    {{ loadingMore() ? 'Loading…' : 'Load more' }}
                  </button>
                </div>
              }
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class EventsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly title = inject(Title);
  private readonly platformId = inject(PLATFORM_ID);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly loadingMore = signal(false);

  async ngOnInit(): Promise<void> {
    this.title.setTitle('Events · Upskills');
    await this.loadFirstPage();
  }

  events(): PublicEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  nextCursor(): string | null {
    const state = this.state();
    return state.status === 'ready' ? state.nextCursor : null;
  }

  async tryAgain(): Promise<void> {
    this.state.set({ status: 'loading' });
    await this.loadFirstPage();
  }

  private async loadFirstPage(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<EventsListResponse>(eventsEndpoint()),
      );

      this.state.set({
        status: 'ready',
        events: response.events,
        nextCursor: response.nextCursor,
      });
    } catch {
      // A freshly booted Cloud Run instance opens its Firestore connection on
      // the first request, which can fail before the instance warms up. If the
      // server paints `error` here, the reader sees "Something went wrong" and
      // then watches it correct itself a moment later when hydration's own
      // fetch succeeds. Render `loading` instead so the browser retries quietly
      // and only shows the error when the client's fetch also fails.
      this.state.set({
        status: isPlatformServer(this.platformId) ? 'loading' : 'error',
      });
    }
  }

  async loadMore(): Promise<void> {
    const state = this.state();
    if (state.status !== 'ready' || state.nextCursor === null) {
      return;
    }

    if (this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get<EventsListResponse>(eventsEndpoint(state.nextCursor)),
      );

      this.state.set({
        status: 'ready',
        events: [...state.events, ...response.events],
        nextCursor: response.nextCursor,
      });
    } catch {
      // Keep the events already on screen; a failed page fetch should not blank
      // them. The button stays because `nextCursor` is unchanged, so the guest
      // can retry. There is no inline error surface here — the list itself is
      // still usable.
    } finally {
      this.loadingMore.set(false);
    }
  }
}
