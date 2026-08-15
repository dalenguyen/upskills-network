import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../auth/auth-guard';
import {
  dashboardEventsEndpoint,
  meEndpoint,
  type DashboardEventsListResponse,
  type MeGetResponse,
  type MeOrg,
  type MeUser,
  type DashboardEvent,
} from '../../dashboard/dashboard-api';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

/**
 * `/dashboard` — the organizer overview.
 *
 * Reads `orgs[0]` from `/api/v1/auth/me` and deliberately does not offer any
 * org switching: that is #65. The events route is only called when there is an
 * org to ask about, because the dashboard routes require a non-empty
 * `?orgId=` and would answer 400 for the no-org state.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'error' }
  | { status: 'ready'; user: MeUser; org: MeOrg; events: DashboardEvent[] };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-overview-page',
  imports: [LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">
              Loading dashboard…
            </p>
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
              <p class="mt-3 text-zinc-600">
                We couldn't load the dashboard. Please refresh to try again.
              </p>
            </section>
          }

          @case ('ready') {
            @if (org(); as currentOrg) {
              <div class="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p class="text-sm font-medium text-indigo-600">
                    Organizer dashboard
                  </p>
                  <h1
                    class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                  >
                    {{ currentOrg.name }}
                  </h1>
                  <p class="mt-2 text-sm text-zinc-600">
                    Signed in as {{ displayName() }} · {{ currentOrg.role }}
                  </p>
                </div>

                <a
                  href="/dashboard/events"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  View events
                </a>
              </div>

              <section class="mt-10" aria-labelledby="event-counts-heading">
                @if (events().length === 0) {
                  <div
                    class="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center"
                  >
                    <h2 class="text-lg font-semibold text-zinc-900">
                      No events yet
                    </h2>
                    <p class="mt-2 text-sm text-zinc-600">
                      This organizer hasn't created any events yet.
                    </p>
                  </div>
                }

                <h2
                  id="event-counts-heading"
                  class="mt-8 text-lg font-semibold text-zinc-900"
                >
                  Events by status
                </h2>

                <dl class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Draft</dt>
                    <dd
                      id="dashboard-draft-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('draft') }}
                    </dd>
                  </div>

                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Published</dt>
                    <dd
                      id="dashboard-published-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('published') }}
                    </dd>
                  </div>

                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Cancelled</dt>
                    <dd
                      id="dashboard-cancelled-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('cancelled') }}
                    </dd>
                  </div>
                </dl>
              </section>
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class DashboardOverviewPageComponent implements OnInit {
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
    } catch {
      this.state.set({ status: 'error' });
    }
  }

  user(): MeUser | null {
    const state = this.state();
    return state.status === 'ready' ? state.user : null;
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  events(): DashboardEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  displayName(): string {
    const user = this.user();

    if (user === null) {
      return '';
    }

    return user.name === undefined || user.name === '' ? user.email : user.name;
  }

  count(status: DashboardEvent['status']): number {
    return this.events().filter((workshop) => workshop.status === status)
      .length;
  }
}
