import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../../auth/auth-guard';
import {
  meEndpoint,
  type MeGetResponse,
  type MeOrg,
} from '../../../../dashboard/dashboard-api';
import { apiErrorCode, apiErrorMessage } from '../../../../events/event-api';
import { EventFormComponent } from '../../../../events/event-form.component';
import { LandingFooterComponent } from '../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../landing/landing-header.component';
import { LoadingStateComponent } from '../../../../landing/loading-state.component';

/**
 * `/dashboard/events/new` — create an event for the caller's first org.
 *
 * Mirrors the list page's load: read `orgs[0]` from `/api/v1/auth/me` and
 * offer no org switching (#65). Only `admin` and `manager` members may create
 * events, because those are the only roles the server route accepts, so the
 * page shows a permission message instead of a form that would 403.
 *
 * The form itself is {@link EventFormComponent}, shared with the edit page and
 * the platform-admin console. This page only decides *which org* is being
 * created under and where to go afterwards.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; org: MeOrg };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-events-new-page',
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
            <app-loading-state label="Loading organizer…" />
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
                You don't have permission to create events
              </h1>
              <p class="mt-3 text-zinc-600">
                Only admin and manager members of an organizer can create
                events.
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
                    New event
                  </h1>
                </div>

                <a
                  href="/dashboard/events"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Back to events
                </a>
              </div>

              <div class="mt-10">
                <app-event-form
                  [orgId]="currentOrg.orgId"
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
export default class DashboardEventsNewPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

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

      if (org.role !== 'admin' && org.role !== 'manager') {
        this.state.set({ status: 'forbidden' });
        return;
      }

      this.state.set({ status: 'ready', org });
    } catch (error) {
      if (apiErrorCode(error) === 'invalid-session') {
        // Not a failure to report: this frame is always replaced. During SSR no
        // session cookie reaches the render, so this 401s on every server-rendered
        // load and the browser re-runs it after hydration with the cookie
        // attached; in the browser, invalidSessionInterceptor is already
        // navigating to /auth/login. The error branch here only ever flashes.
        return;
      }

      this.state.set({
        status: 'error',
        message:
          apiErrorMessage(error) ??
          "We couldn't load this page. Please refresh to try again.",
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

  protected async onSaved(): Promise<void> {
    await this.router.navigateByUrl('/dashboard/events');
  }
}
