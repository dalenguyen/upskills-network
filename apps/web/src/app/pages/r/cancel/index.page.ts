import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  apiErrorStatus,
  cancelEndpoint,
  type CancelResponse,
} from '../../../events/event-api';
import { LandingFooterComponent } from '../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../landing/landing-header.component';

/**
 * `/r/cancel` — where a guest's cancel link lands.
 *
 * The link carries `org`, `event`, `email`, and `token` as query params — see
 * `cancelUrl` in `@upskills/email`, which is the only place that builds this
 * URL. Cancelling is a deliberate click here, not something the page does on
 * load: a mail client or security scanner that prefetches links in an inbox
 * would otherwise cancel a guest's spot before they ever opened the email.
 */

interface CancelParams {
  orgId: string;
  eventId: string;
  email: string;
  token: string;
}

type PageState =
  | { status: 'missing-link' }
  | { status: 'ready'; params: CancelParams }
  | { status: 'submitting' }
  | { status: 'done'; result: CancelResponse }
  | { status: 'invalid' }
  | { status: 'error' };

@Component({
  selector: 'app-cancel-page',
  imports: [RouterLink, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-lg">
        @switch (state().status) {
          @case ('missing-link') {
            <section class="py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that cancellation link
              </h1>
              <p class="mt-3 text-zinc-600">
                The link may be incomplete. Use the "release your spot" link
                from your confirmation email instead.
              </p>
            </section>
          }

          @case ('invalid') {
            <section class="py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                That cancellation link is not valid
              </h1>
              <p class="mt-3 text-zinc-600">
                Check the link in your confirmation email, or contact the
                organizer if you can't find it.
              </p>
            </section>
          }

          @case ('error') {
            <section class="py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't process the cancellation. Please try again.
              </p>
              <button
                type="button"
                (click)="cancel()"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Try again
              </button>
            </section>
          }

          @case ('done') {
            @if (result(); as cancelResult) {
              <section class="py-12 text-center" role="status">
                <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                  {{
                    cancelResult.alreadyCancelled
                      ? 'Your spot was already released'
                      : 'Your spot has been released'
                  }}
                </h1>
                <p class="mt-3 text-zinc-600">
                  @if (!cancelResult.emailSent) {
                    We couldn't send a confirmation email, but the cancellation
                    went through.
                  } @else {
                    A confirmation has been sent to your email.
                  }
                </p>
                <a
                  routerLink="/events"
                  class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Browse other events
                </a>
              </section>
            }
          }

          @default {
            <section class="py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Release your spot?
              </h1>
              <p class="mt-3 text-zinc-600">
                Cancelling releases your spot immediately. If you paid, the
                payment is not refunded automatically — contact the organizer to
                ask about one.
              </p>
              <button
                type="button"
                [disabled]="submitting()"
                (click)="cancel()"
                class="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {{ submitting() ? 'Releasing your spot…' : 'Release my spot' }}
              </button>
            </section>
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class CancelPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<PageState>({ status: 'missing-link' });

  private params: CancelParams | null = null;

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const orgId = query.get('org');
    const eventId = query.get('event');
    const email = query.get('email');
    const token = query.get('token');

    if (!orgId || !eventId || !email || !token) {
      this.state.set({ status: 'missing-link' });
      return;
    }

    this.params = { orgId, eventId, email, token };
    this.state.set({ status: 'ready', params: this.params });
  }

  async cancel(): Promise<void> {
    const params = this.params;

    if (params === null || this.submitting()) {
      return;
    }

    this.state.set({ status: 'submitting' });

    try {
      const result = await firstValueFrom(
        this.http.post<CancelResponse>(
          cancelEndpoint(params.orgId, params.eventId),
          { email: params.email, cancelToken: params.token },
        ),
      );

      this.state.set({ status: 'done', result });
    } catch (error) {
      this.state.set({
        status: apiErrorStatus(error) === 403 ? 'invalid' : 'error',
      });
    }
  }

  submitting(): boolean {
    return this.state().status === 'submitting';
  }

  result(): CancelResponse | null {
    const state = this.state();
    return state.status === 'done' ? state.result : null;
  }
}
