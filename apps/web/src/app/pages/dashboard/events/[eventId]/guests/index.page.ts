import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../../../auth/auth-guard';
import {
  dashboardEventDetailEndpoint,
  dashboardEventGuestsEndpoint,
  dashboardOrgDetailEndpoint,
  meEndpoint,
  type DashboardEvent,
  type DashboardEventsDetailResponse,
  type DashboardEventsGuestsResponse,
  type DashboardOrgsDetailResponse,
  type GuestView,
  type MeGetResponse,
} from '../../../../../dashboard/dashboard-api';
import {
  apiErrorCode,
  apiErrorMessage,
  apiErrorStatus,
} from '../../../../../events/event-api';
import { LandingFooterComponent } from '../../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../../landing/landing-header.component';
import { LoadingStateComponent } from '../../../../../landing/loading-state.component';

/**
 * `/dashboard/events/[eventId]/guests` — the guest list for one event.
 *
 * For a member of the org this reads `orgs[0]` from `/api/v1/auth/me`, no org
 * switching (#65). The platform-admin console links here with `?orgId=` instead:
 * a platform admin is not necessarily a member of the org they are inspecting,
 * so the org is read from the URL and the page skips the membership-role gate.
 * Either way a 403 from a dashboard route is rendered as "not found or you
 * can't see it" rather than a retry prompt.
 *
 * The guest list itself carries no email address — see
 * `handlers/dashboard/events-guests.ts`. A name and a status are what this
 * page is for: knowing who is coming, and whether they showed up.
 */

interface GuestListOrg {
  name: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      org: GuestListOrg;
      workshop: DashboardEvent;
      guests: GuestView[];
    };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-events-guests-page',
  imports: [
    LandingHeaderComponent,
    LandingFooterComponent,
    LoadingStateComponent,
  ],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-4xl">
        @switch (state().status) {
          @case ('loading') {
            <app-loading-state label="Loading guest list…" />
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

          @case ('forbidden') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                You don't have permission to view this guest list
              </h1>
              <p class="mt-3 text-zinc-600">
                Only admin and manager members of an organizer can see guests.
              </p>
            </section>
          }

          @case ('not-found') {
            <section class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that event
              </h1>
              <p class="mt-3 text-zinc-600">
                It may have been removed, or you don't have permission to see
                it.
              </p>
              <a
                href="/dashboard/events"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Back to events
              </a>
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
                    {{ workshop()?.title }}
                  </h1>
                  <p class="mt-2 text-sm text-zinc-600">{{ capacity() }}</p>
                </div>

                <a
                  href="/dashboard/events"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Back to events
                </a>
              </div>

              @if (guests().length === 0) {
                <section
                  class="mt-10 rounded-xl border border-dashed border-zinc-300 py-12 text-center"
                >
                  <h2 class="text-lg font-semibold text-zinc-900">
                    No guests yet
                  </h2>
                  <p class="mt-2 text-sm text-zinc-600">
                    Nobody has registered for this event yet.
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
                          Name
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
                          Registered
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Checked in
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100">
                      @for (guest of guests(); track $index) {
                        <tr>
                          <td class="px-4 py-3 font-medium text-zinc-900">
                            {{ guest.name }}
                            @if (
                              guest.status === 'pending' &&
                              guest.waitlistPosition
                            ) {
                              <span class="ml-2 text-xs text-zinc-500">
                                (#{{ guest.waitlistPosition }} on waitlist)
                              </span>
                            }
                          </td>
                          <td class="px-4 py-3 capitalize text-zinc-700">
                            {{ guest.status }}
                          </td>
                          <td class="px-4 py-3 text-zinc-700">
                            {{ formatDate(guest.registeredAt) }}
                          </td>
                          <td class="px-4 py-3 text-zinc-700">
                            {{
                              guest.checkedInAt
                                ? formatDate(guest.checkedInAt)
                                : '—'
                            }}
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
export default class DashboardEventsGuestsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<PageState>({ status: 'loading' });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const eventId = this.route.snapshot.paramMap.get('eventId');

    if (eventId === null || eventId === '') {
      this.state.set({ status: 'not-found' });
      return;
    }

    const urlOrgId = this.route.snapshot.queryParamMap.get('orgId');

    if (urlOrgId !== null && urlOrgId !== '') {
      await this.loadForOrg(eventId, urlOrgId);
      return;
    }

    try {
      const me = await firstValueFrom(
        this.http.get<MeGetResponse>(meEndpoint(), { withCredentials: true }),
      );

      if (me.orgs.length === 0) {
        this.state.set({ status: 'no-orgs' });
        return;
      }

      const org = me.orgs[0];

      if (org.role !== 'admin' && org.role !== 'manager') {
        this.state.set({ status: 'forbidden' });
        return;
      }

      const [detail, guestList] = await Promise.all([
        firstValueFrom(
          this.http.get<DashboardEventsDetailResponse>(
            dashboardEventDetailEndpoint(org.orgId, eventId),
            { withCredentials: true },
          ),
        ),
        firstValueFrom(
          this.http.get<DashboardEventsGuestsResponse>(
            dashboardEventGuestsEndpoint(org.orgId, eventId),
            { withCredentials: true },
          ),
        ),
      ]);

      this.state.set({
        status: 'ready',
        org,
        workshop: detail.event,
        guests: guestList.guests,
      });
    } catch (error) {
      if (apiErrorCode(error) === 'invalid-session') {
        // Not a failure to report: this frame is always replaced. During SSR no
        // session cookie reaches the render, so this 401s on every server-rendered
        // load and the browser re-runs it after hydration with the cookie
        // attached; in the browser, invalidSessionInterceptor is already
        // navigating to /auth/login. The error branch here only ever flashes.
        return;
      }

      if (apiErrorStatus(error) === 403) {
        this.state.set({ status: 'not-found' });
        return;
      }

      this.state.set({
        status: 'error',
        message:
          apiErrorMessage(error) ??
          "We couldn't load the guest list. Please refresh to try again.",
      });
    }
  }

  /**
   * Load the guest list for an org named in the URL, rather than for the
   * signed-in user's own membership.
   *
   * The platform-admin console links here with `?orgId=`, and a platform admin
   * has no membership row to read from `me.orgs[0]`. The dashboard routes
   * authorize that caller themselves; the client just needs to ask about the
   * org it was given. The org detail read is only for the name above the list.
   */
  private async loadForOrg(eventId: string, orgId: string): Promise<void> {
    try {
      // Confirmed first, on its own: a caller forbidden from this org is also
      // forbidden from its event and guest list, so there is no point firing
      // those two requests before this one has answered.
      const orgResponse = await firstValueFrom(
        this.http.get<DashboardOrgsDetailResponse>(
          dashboardOrgDetailEndpoint(orgId),
          { withCredentials: true },
        ),
      );

      const [detail, guestList] = await Promise.all([
        firstValueFrom(
          this.http.get<DashboardEventsDetailResponse>(
            dashboardEventDetailEndpoint(orgId, eventId),
            { withCredentials: true },
          ),
        ),
        firstValueFrom(
          this.http.get<DashboardEventsGuestsResponse>(
            dashboardEventGuestsEndpoint(orgId, eventId),
            { withCredentials: true },
          ),
        ),
      ]);

      this.state.set({
        status: 'ready',
        org: { name: orgResponse.org.name },
        workshop: detail.event,
        guests: guestList.guests,
      });
    } catch (error) {
      if (apiErrorCode(error) === 'invalid-session') {
        // Not a failure to report: this frame is always replaced. During SSR no
        // session cookie reaches the render, so this 401s on every server-rendered
        // load and the browser re-runs it after hydration with the cookie
        // attached; in the browser, invalidSessionInterceptor is already
        // navigating to /auth/login. The error branch here only ever flashes.
        return;
      }

      if (apiErrorStatus(error) === 403) {
        this.state.set({ status: 'not-found' });
        return;
      }

      this.state.set({
        status: 'error',
        message:
          apiErrorMessage(error) ??
          "We couldn't load the guest list. Please refresh to try again.",
      });
    }
  }

  org(): GuestListOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  errorMessage(): string {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  }

  workshop(): DashboardEvent | null {
    const state = this.state();
    return state.status === 'ready' ? state.workshop : null;
  }

  guests(): GuestView[] {
    const state = this.state();
    return state.status === 'ready' ? state.guests : [];
  }

  /** "9/10 spots filled", or "Unlimited capacity" when `maxGuests` is 0. */
  capacity(): string {
    const workshop = this.workshop();

    if (workshop === null) {
      return '';
    }

    return workshop.maxGuests === 0
      ? 'Unlimited capacity'
      : `${workshop.confirmedCount}/${workshop.maxGuests} spots filled`;
  }

  formatDate(value: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return value;
    }
  }
}
