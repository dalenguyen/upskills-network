import { DOCUMENT, isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  apiErrorStatus,
  orgEndpoint,
  orgPath,
  type OrgDetailResponse,
  type PublicEvent,
  type PublicOrg,
} from '../../events/event-api';
import { EventCardComponent } from '../../events/event-card.component';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';
import { LoadingStateComponent } from '../../landing/loading-state.component';

/**
 * `/:orgSlug` — an organizer's public page: their upcoming events, then their
 * past ones.
 *
 * Built the same way as `/events`: both lists are fetched in `ngOnInit`, in
 * parallel, so SSR renders the whole page in one pass and hydration replays
 * the responses. The past list is secondary and stays hidden when it is empty
 * or fails. See `pages/events/index.page.ts` for the reasoning.
 *
 * ## An organizer with nothing scheduled is still a page
 *
 * The API answers 200 with no events for a real organizer, and 404 only for an
 * unknown slug. Their slug is in the URL of every event they ever published,
 * so a bookmarked link must keep working between schedules.
 *
 * Organizer slugs cannot collide with the app's own top-level routes
 * (`/events`, `/dashboard`, ...): `RESERVED_SLUGS` in `@upskills/validation`
 * refuses them at creation.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | {
      status: 'ready';
      org: PublicOrg;
      events: PublicEvent[];
      nextCursor: string | null;
    };

/** The past list: absent until its first page arrives, and on any failure. */
interface PastState {
  events: PublicEvent[];
  nextCursor: string | null;
}

@Component({
  selector: 'app-org-page',
  imports: [
    EventCardComponent,
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
            <app-loading-state label="Loading organizer…" />
          }

          @case ('not-found') {
            <div class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that organizer
              </h1>
              <p class="mt-3 text-zinc-600">The link may be out of date.</p>
              <a
                href="/events"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Browse all events
              </a>
            </div>
          }

          @case ('error') {
            <div class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load this organizer. Please refresh to try again.
              </p>
            </div>
          }

          @case ('ready') {
            <div class="mx-auto max-w-2xl text-center">
              <p
                class="text-xs font-semibold uppercase tracking-widest text-indigo-600"
              >
                Organizer
              </p>
              <h1
                class="mt-3 text-balance text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
              >
                {{ org()?.name }}
              </h1>
            </div>

            @if (events().length === 0) {
              <section
                class="mt-12 rounded-xl border border-dashed border-zinc-300 py-16 text-center"
              >
                <h2 class="text-lg font-semibold text-zinc-900">
                  No upcoming events
                </h2>
                <p class="mt-2 text-sm text-zinc-600">
                  Nothing is scheduled right now.
                </p>
                <a
                  href="/events"
                  class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Browse all events
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

              @if (nextCursor()) {
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

            @if (past(); as pastList) {
              @if (pastList.events.length > 0) {
                <section class="mt-20" aria-labelledby="past-events-heading">
                  <h2
                    id="past-events-heading"
                    class="text-2xl font-bold tracking-tight text-zinc-900"
                  >
                    Past events
                  </h2>

                  <div
                    class="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    @for (event of pastList.events; track event.eventId) {
                      <app-event-card [event]="event" [ended]="true" />
                    }
                  </div>

                  @if (pastList.nextCursor) {
                    <div class="mt-12 text-center">
                      <button
                        type="button"
                        [disabled]="loadingMorePast()"
                        (click)="loadMorePast()"
                        class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      >
                        {{
                          loadingMorePast()
                            ? 'Loading…'
                            : 'Load more past events'
                        }}
                      </button>
                    </div>
                  }
                </section>
              }
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class OrgPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly loadingMore = signal(false);
  readonly past = signal<PastState | null>(null);
  readonly loadingMorePast = signal(false);

  private slug = '';

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('orgSlug');

    if (!slug) {
      this.state.set({ status: 'not-found' });
      return;
    }

    this.slug = slug;
    await Promise.all([this.loadFirstPage(), this.loadPast()]);
  }

  org(): PublicOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  events(): PublicEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  nextCursor(): string | null {
    const state = this.state();
    return state.status === 'ready' ? state.nextCursor : null;
  }

  async loadMore(): Promise<void> {
    const state = this.state();
    if (
      state.status !== 'ready' ||
      state.nextCursor === null ||
      this.loadingMore()
    ) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get<OrgDetailResponse>(
          orgEndpoint(this.slug, state.nextCursor),
        ),
      );

      this.state.set({
        ...state,
        events: [...state.events, ...response.events],
        nextCursor: response.nextCursor,
      });
    } catch {
      // Keep what is on screen; the button stays, so the visitor can retry.
    } finally {
      this.loadingMore.set(false);
    }
  }

  async loadMorePast(): Promise<void> {
    const past = this.past();
    if (past === null || past.nextCursor === null || this.loadingMorePast()) {
      return;
    }

    this.loadingMorePast.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get<OrgDetailResponse>(
          orgEndpoint(this.slug, past.nextCursor, 'past'),
        ),
      );

      this.past.set({
        events: [...past.events, ...response.events],
        nextCursor: response.nextCursor,
      });
    } catch {
      // Same as `loadMore`.
    } finally {
      this.loadingMorePast.set(false);
    }
  }

  private async loadFirstPage(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<OrgDetailResponse>(orgEndpoint(this.slug)),
      );

      this.state.set({
        status: 'ready',
        org: response.org,
        events: response.events,
        nextCursor: response.nextCursor,
      });
      this.applyOrgMeta(response.org);
    } catch (error) {
      if (apiErrorStatus(error) === 404) {
        this.state.set({ status: 'not-found' });
        return;
      }

      // A cold Cloud Run instance can fail its first Firestore call. On the
      // server, render `loading` so the browser retries quietly instead of
      // flashing an error — same as `/events`.
      this.state.set({
        status: isPlatformServer(this.platformId) ? 'loading' : 'error',
      });
    }
  }

  private async loadPast(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<OrgDetailResponse>(
          orgEndpoint(this.slug, undefined, 'past'),
        ),
      );

      this.past.set({
        events: response.events,
        nextCursor: response.nextCursor,
      });
    } catch {
      // Secondary list: stay hidden rather than show an error.
    }
  }

  /** Name the organizer to crawlers and link unfurls. See the event page. */
  private applyOrgMeta(org: PublicOrg): void {
    const title = `${org.name} · Upskills`;
    const description = `Workshops and events by ${org.name} on Upskills.`;
    const url = `https://upskillsnetwork.com${orgPath(org.slug)}`;

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });

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
