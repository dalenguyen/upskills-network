import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import {
  apiErrorStatus,
  eventDetailEndpoint,
  eventPath,
  type EventDetailResponse,
  type PublicEvent,
} from '../../events/event-api';
import { EventDetailComponent } from '../../events/event-detail.component';
import { ExternalCtaComponent } from '../../events/external-cta.component';
import { RegistrationFormComponent } from '../../events/registration-form.component';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';
import { LoadingStateComponent } from '../../landing/loading-state.component';

/**
 * `/:orgSlug/:eventSlug` — the page that converts.
 *
 * ## Why the organizer is in the URL
 *
 * Event slugs are unique per organizer rather than globally, so `react-basics`
 * on its own does not name an event — two organizers may each have one. The
 * organizer segment is what disambiguates, and it makes the URL read like the
 * thing it points at: `/acme/react-basics`.
 *
 * This route sits at the **root**, so an organizer slug occupies the same
 * namespace as every static page in this directory. `RESERVED_SLUGS` in
 * `@upskills/validation` is what stops an organizer claiming `login` or
 * `dashboard`; this file is the reason that list has to exist.
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
    ExternalCtaComponent,
    RegistrationFormComponent,
    LandingHeaderComponent,
    LandingFooterComponent,
    LoadingStateComponent,
  ],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <app-loading-state label="Loading workshop…" />
          }

          @case ('ready') {
            <div class="grid gap-10 lg:grid-cols-5 lg:gap-16">
              <div class="lg:col-span-3">
                <app-event-detail [event]="event()!" />
              </div>

              <div class="lg:col-span-2">
                <div class="lg:sticky lg:top-24">
                  <!-- An externalUrl means this event is listed here and run
                       elsewhere, so there is nothing for a form to submit to.
                       Cosmetic only: the register endpoint refuses these on its
                       own, which is what makes the swap safe to get wrong. -->
                  @if (event()!.externalUrl) {
                    <app-external-cta [event]="event()!" />
                  } @else {
                    <app-registration-form [event]="event()!" />
                  }
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
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  readonly state = signal<PageState>({ status: 'loading' });

  /** The loaded event, or `null` in every state that has none. */
  event(): PublicEvent | null {
    const state = this.state();
    return state.status === 'ready' ? state.event : null;
  }

  async ngOnInit(): Promise<void> {
    const orgSlug = this.route.snapshot.paramMap.get('orgSlug');
    const eventSlug = this.route.snapshot.paramMap.get('eventSlug');

    if (!orgSlug || !eventSlug) {
      this.state.set({ status: 'not-found' });
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<EventDetailResponse>(
          eventDetailEndpoint(orgSlug, eventSlug),
        ),
      );

      this.state.set({ status: 'ready', event: response.event });
      this.applyEventMeta(response.event);
    } catch (error) {
      this.state.set({
        status: apiErrorStatus(error) === 404 ? 'not-found' : 'error',
      });
    }
  }

  /**
   * Publish the loaded event to crawlers and social scrapers.
   *
   * The `<title>`/description tags in `index.html` describe the whole site, not
   * a single workshop. This overrides them for the page that actually converts,
   * so a search result and an unfurled link both name the event rather than the
   * brand. `updateTag` (not `addTag`) matters: `index.html` already ships an
   * `og:title`, `og:description`, and `og:url`, and a second copy would leave
   * scrapers guessing which one to honour.
   */
  private applyEventMeta(event: PublicEvent): void {
    const title = `${event.title} · Upskills`;
    const url = `https://upskillsnetwork.com${eventPath(event)}`;

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: event.description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({
      property: 'og:description',
      content: event.description,
    });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({
      name: 'twitter:description',
      content: event.description,
    });
    this.setCanonicalUrl(url);
  }

  /**
   * Point the canonical link at this event rather than the homepage it inherits
   * from `index.html`, so the event page is indexed as its own URL.
   */
  private setCanonicalUrl(url: string): void {
    let link = this.document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );

    if (link === null) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }

    link.setAttribute('href', url);
  }
}
