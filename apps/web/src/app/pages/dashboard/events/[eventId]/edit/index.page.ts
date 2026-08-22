import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../../../auth/auth-guard';
import {
  dashboardEventDetailEndpoint,
  meEndpoint,
  type DashboardEvent,
  type DashboardEventsDetailResponse,
  type MeGetResponse,
  type MeOrg,
} from '../../../../../dashboard/dashboard-api';
import {
  apiErrorCode,
  apiErrorMessage,
  apiErrorStatus,
} from '../../../../../events/event-api';
import { EventFormComponent } from '../../../../../events/event-form.component';
import { LandingFooterComponent } from '../../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../../landing/landing-header.component';
import { LoadingStateComponent } from '../../../../../landing/loading-state.component';

/**
 * `/dashboard/events/[eventId]/edit` — edit one event for the caller's first org.
 *
 * Mirrors the create page's org handling: read `orgs[0]` from
 * `/api/v1/auth/me` and offer no org switching (#65). The detail route answers
 * 403 for a missing event and an event the caller cannot edit alike, so a 403
 * here is rendered as "not found or you can't edit it" rather than a retry
 * prompt.
 *
 * The form is {@link EventFormComponent}, the same one the create page and the
 * platform-admin console render; passing it an event puts it in edit mode.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; org: MeOrg; workshop: DashboardEvent };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-events-edit-page',
  imports: [
    EventFormComponent,
    LandingHeaderComponent,
    LandingFooterComponent,
    LoadingStateComponent,
  ],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-3xl">
        @switch (state().status) {
          @case ('loading') {
            <app-loading-state label="Loading event…" />
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
                You don't have permission to edit events
              </h1>
              <p class="mt-3 text-zinc-600">
                Only admin and manager members of an organizer can edit events.
              </p>
            </section>
          }

          @case ('not-found') {
            <section class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that event
              </h1>
              <p class="mt-3 text-zinc-600">
                It may have been removed, or you don't have permission to edit
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

          @case ('cancelled') {
            <section class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                This event has been cancelled
              </h1>
              <p class="mt-3 text-zinc-600">
                A cancelled event can't be edited. Cancelling is final and
                already notified every confirmed guest.
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
                    Edit event
                  </h1>
                </div>

                <div class="flex gap-3">
                  <a
                    [href]="guestsPath()"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    View guests
                  </a>

                  <a
                    href="/dashboard/events"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    Back to events
                  </a>
                </div>
              </div>

              <div class="mt-10">
                <app-event-form
                  [orgId]="currentOrg.orgId"
                  [event]="workshop()"
                  (saved)="onSaved()"
                />
              </div>
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class DashboardEventsEditPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

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

      const response = await firstValueFrom(
        this.http.get<DashboardEventsDetailResponse>(
          dashboardEventDetailEndpoint(org.orgId, eventId),
          { withCredentials: true },
        ),
      );

      if (response.event.status === 'cancelled') {
        this.state.set({ status: 'cancelled' });
        return;
      }

      this.state.set({ status: 'ready', org, workshop: response.event });
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
          "We couldn't load this event. Please refresh to try again.",
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

  guestsPath(): string {
    const state = this.state();
    return state.status === 'ready'
      ? `/dashboard/events/${state.workshop.eventId}/guests`
      : '/dashboard/events';
  }

  workshop(): DashboardEvent | null {
    const state = this.state();
    return state.status === 'ready' ? state.workshop : null;
  }

  protected async onSaved(): Promise<void> {
    await this.router.navigateByUrl('/dashboard/events');
  }
}
