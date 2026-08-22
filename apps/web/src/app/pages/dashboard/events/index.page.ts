import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../auth/auth-guard';
import {
  dashboardEventsEndpoint,
  meEndpoint,
  type DashboardEventsListResponse,
  type MeGetResponse,
  type MeOrg,
  type MeUser,
  type DashboardEvent,
} from '../../../dashboard/dashboard-api';
import { apiErrorCode, apiErrorMessage } from '../../../events/event-api';
import { EventListComponent } from '../../../events/event-list.component';
import { LandingFooterComponent } from '../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../landing/landing-header.component';
import { LoadingStateComponent } from '../../../landing/loading-state.component';

/**
 * `/dashboard/events` — the org's event list.
 *
 * Reads `orgs[0]` from `/api/v1/auth/me` and deliberately does not offer any
 * org switching: that is #65. The list route is only called when there is an
 * org to ask about, because the dashboard routes require a non-empty
 * `?orgId=` and would answer 400 for the no-org state.
 *
 * Sort order comes from the API (newest first). This page renders the response
 * in the order it arrives and never re-sorts client-side.
 *
 * The table itself is {@link EventListComponent}, shared with the
 * platform-admin console. It owns Cancel and reports back with `changed`, which
 * this page answers by re-fetching the list.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: MeUser; org: MeOrg; events: DashboardEvent[] };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-events-page',
  imports: [
    EventListComponent,
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
            <app-loading-state label="Loading events…" />
          }

          @case ('no-orgs') {
            <section class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                No organizer yet
              </h1>
              <p class="mt-3 text-zinc-600">
                Your account is not a member of an organizer yet.
              </p>
            </section>
          }

          @case ('error') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">{{ errorMessage() }}</p>
            </section>
          }

          @case ('ready') {
            @if (org(); as currentOrg) {
              <div class="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p class="text-sm font-medium text-indigo-600">
                    {{ currentOrg.name }}
                  </p>
                  <h1
                    class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                  >
                    Events
                  </h1>
                </div>

                <div class="flex flex-wrap items-center gap-3">
                  <a
                    href="/dashboard/events/new"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    New event
                  </a>
                  <a
                    href="/dashboard"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    Back to dashboard
                  </a>
                </div>
              </div>

              <app-event-list
                [events]="events()"
                [orgId]="currentOrg.orgId"
                [orgSlug]="currentOrg.slug"
                editLinkBase="/dashboard/events"
                (changed)="onChanged()"
              />
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class DashboardEventsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly state = signal<PageState>({ status: 'loading' });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const me = await firstValueFrom(
        this.http.get<MeGetResponse>(meEndpoint(), { withCredentials: true }),
      );

      if (me.orgs.length === 0) {
        this.state.set({ status: 'no-orgs' });
        return;
      }

      const org = me.orgs[0];

      const response = await firstValueFrom(
        this.http.get<DashboardEventsListResponse>(
          dashboardEventsEndpoint(org.orgId),
          { withCredentials: true },
        ),
      );

      this.state.set({
        status: 'ready',
        user: me.user,
        org,
        events: response.events,
      });
    } catch (error) {
      if (apiErrorCode(error) === 'invalid-session') {
        // Not a failure to report: this frame is always replaced. During SSR no
        // session cookie reaches the render, so this 401s on every server-rendered
        // load and the browser re-runs it after hydration with the cookie
        // attached; in the browser, invalidSessionInterceptor is already
        // navigating to /auth/login. Back to 'loading' rather than a bare return,
        // because this also runs after a mutation, where leaving the previous
        // 'ready' state up would keep authenticated content on screen that the
        // session no longer covers while that navigation lands.
        this.state.set({ status: 'loading' });
        return;
      }

      this.state.set({
        status: 'error',
        message:
          apiErrorMessage(error) ??
          "We couldn't load these events. Please refresh to try again.",
      });
    }
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  errorMessage(): string {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  }

  events(): DashboardEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  /**
   * Re-fetch after the table cancelled or deleted something.
   *
   * A re-fetch rather than a local edit, because a cancel can change more than
   * the row it started from — the server is the only place that knows what the
   * list looks like now.
   */
  protected async onChanged(): Promise<void> {
    const state = this.state();

    if (state.status !== 'ready') {
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<DashboardEventsListResponse>(
          dashboardEventsEndpoint(state.org.orgId),
          { withCredentials: true },
        ),
      );

      this.state.set({ ...state, events: response.events });
    } catch {
      // The table already shows what went wrong with the write itself. Leaving
      // the previous rows on screen beats replacing the page with an error.
    }
  }
}
