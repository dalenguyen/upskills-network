import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import {
  eventDetailEndpoint,
  type EventDetailResponse,
  type PublicEvent,
} from '../../events/event-api';
import { EventDetailComponent } from '../../events/event-detail.component';
import { RegistrationFormComponent } from '../../events/registration-form.component';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

/**
 * `/events/:slug` — the page that converts.
 *
 * ## Why the fetch runs in `ngOnInit` rather than a route resolver
 *
 * The request is issued through `HttpClient` during `ngOnInit`, which on the
 * server registers a pending task: SSR waits for it, renders the finished page,
 * and the hydration transfer cache replays the response in the browser instead
 * of issuing a second request. A resolver would buy the same thing at the cost
 * of a second file and an indirection, and this page reads exactly one endpoint.
 *
 * ## A draft event is a 404 here too
 *
 * `GET /api/v1/events/:slug` answers 404 for missing, draft, and cancelled
 * events alike — deliberately indistinguishable, so a guessable slug cannot
 * confirm an unannounced workshop exists. This page repeats that answer rather
 * than trying to be more specific than the route it called; the "went wrong"
 * state is reserved for a genuine transport or server failure, where inviting a
 * retry is the useful thing to say.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; event: PublicEvent }
  | { status: 'not-found' }
  | { status: 'error' };

@Component({
  selector: 'app-event-page',
  imports: [
    EventDetailComponent,
    RegistrationFormComponent,
    LandingHeaderComponent,
    LandingFooterComponent,
  ],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">Loading workshop…</p>
          }

          @case ('ready') {
            <div class="grid gap-10 lg:grid-cols-5 lg:gap-16">
              <div class="lg:col-span-3">
                <app-event-detail [event]="event()!" />
              </div>

              <div class="lg:col-span-2">
                <div class="lg:sticky lg:top-24">
                  <app-registration-form [event]="event()!" />
                </div>
              </div>
            </div>
          }

          @case ('not-found') {
            <div class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that workshop
              </h1>
              <p class="mt-3 text-zinc-600">
                It may have been unpublished, or the link may be out of date.
              </p>
              <a
                href="/"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Back to Upskills
              </a>
            </div>
          }

          @case ('error') {
            <div class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load this workshop. Please refresh to try again.
              </p>
            </div>
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class EventPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);

  readonly state = signal<PageState>({ status: 'loading' });

  /** The loaded event, or `null` in every state that has none. */
  event(): PublicEvent | null {
    const state = this.state();
    return state.status === 'ready' ? state.event : null;
  }

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');

    if (slug === null || slug === '') {
      this.state.set({ status: 'not-found' });
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<EventDetailResponse>(eventDetailEndpoint(slug)),
      );

      this.state.set({ status: 'ready', event: response.event });
      this.title.setTitle(`${response.event.title} · Upskills`);
    } catch (error) {
      this.state.set({
        status:
          error instanceof HttpErrorResponse && error.status === 404
            ? 'not-found'
            : 'error',
      });
    }
  }
}
