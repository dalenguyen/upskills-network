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
import { LandingFooterComponent } from '../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../landing/landing-header.component';

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
  selector: 'app-dashboard-events-page',
  imports: [LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">Loading events…</p>
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
                We couldn't load these events. Please refresh to try again.
              </p>
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

                <a
                  href="/dashboard"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Back to dashboard
                </a>
              </div>

              @if (events().length === 0) {
                <section
                  class="mt-12 rounded-xl border border-dashed border-zinc-300 py-12 text-center"
                >
                  <h2 class="text-lg font-semibold text-zinc-900">
                    No events yet
                  </h2>
                  <p class="mt-2 text-sm text-zinc-600">
                    This organizer hasn't created any events yet.
                  </p>
                </section>
              } @else {
                <div
                  class="mt-8 overflow-x-auto rounded-xl border border-zinc-200"
                >
                  <table class="min-w-full divide-y divide-zinc-200 text-left">
                    <thead class="bg-zinc-50">
                      <tr>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Title
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Status
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Start date
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Capacity
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100">
                      @for (workshop of events(); track workshop.eventId) {
                        <tr>
                          <td class="px-4 py-3">
                            <a
                              [href]="'/events/' + workshop.slug"
                              class="font-medium text-indigo-600 transition hover:text-indigo-500"
                            >
                              {{ workshop.title }}
                            </a>
                            @if (workshop.status !== 'cancelled') {
                              <a
                                [href]="
                                  '/dashboard/events/' +
                                  workshop.eventId +
                                  '/edit'
                                "
                                class="ml-3 text-sm font-medium text-zinc-500 transition hover:text-zinc-700"
                              >
                                Edit
                              </a>
                            }
                          </td>
                          <td class="px-4 py-3 capitalize text-zinc-700">
                            {{ workshop.status }}
                          </td>
                          <td class="px-4 py-3 text-zinc-700">
                            {{ startDate(workshop) }}
                          </td>
                          <td class="px-4 py-3 text-zinc-700">
                            {{ capacity(workshop) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
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
    } catch {
      this.state.set({ status: 'error' });
    }
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  events(): DashboardEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  startDate(workshop: DashboardEvent): string {
    // `startsAt` is an ISO-8601 string, not a `Timestamp`: the route serializes
    // it because a Firestore `Timestamp` does not survive JSON.
    const date = new Date(workshop.startsAt);

    try {
      return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        timeZone: workshop.timezone,
      }).format(date);
    } catch {
      // An unknown IANA zone throws a RangeError. The UTC instant is a worse
      // answer than the organizer's local date, but it is still readable.
      return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(
        date,
      );
    }
  }

  capacity(workshop: DashboardEvent): string {
    return workshop.maxGuests === 0
      ? 'Unlimited'
      : `${workshop.maxGuests} guests`;
  }
}
