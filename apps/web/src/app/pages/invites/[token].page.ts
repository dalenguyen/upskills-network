import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  inviteAcceptEndpoint,
  inviteDetailEndpoint,
  type InviteAcceptResponse,
  type InviteDetailResponse,
} from '../../invites/invites-api';
import { apiErrorCode, apiErrorStatus } from '../../events/event-api';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

/**
 * `/invites/[token]` — where an invitation email lands.
 *
 * ## Why this page is not behind `authGuard`
 *
 * The visitor arrives from their inbox, usually with no session and sometimes
 * with no account. Bouncing them to a login page would ask them to register for
 * something they cannot see the purpose of, so the page loads the invitation
 * first — org name, role, and the address it was sent to — and only then asks
 * for a sign-in. The detail route answers that much from the token alone and
 * nothing more; the membership is written by `POST …/accept`, which does check
 * the session and does check that its email matches the invitation.
 *
 * So the sign-in prompt here is a nicety, exactly as `authGuard` is elsewhere:
 * the accept route is what actually decides.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; invite: InviteDetailResponse['invite'] }
  | { status: 'accepted'; result: InviteAcceptResponse }
  | { status: 'not-found' }
  | { status: 'unusable'; message: string }
  | { status: 'error' };

@Component({
  selector: 'app-invite-accept-page',
  imports: [RouterLink, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-lg">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">
              Loading invitation…
            </p>
          }

          @case ('not-found') {
            <section class="py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that invitation
              </h1>
              <p class="mt-3 text-zinc-600">
                The link may be incomplete. Ask whoever invited you to send a
                new one.
              </p>
            </section>
          }

          @case ('unusable') {
            <section class="py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                This invitation can't be used
              </h1>
              <p class="mt-3 text-zinc-600">{{ unusableMessage() }}</p>
              <a
                routerLink="/dashboard"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Go to your dashboard
              </a>
            </section>
          }

          @case ('error') {
            <section class="py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load this invitation. Please refresh to try again.
              </p>
            </section>
          }

          @case ('accepted') {
            @if (accepted(); as result) {
              <section class="py-12 text-center">
                <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                  You've joined {{ result.orgName }}
                </h1>
                <p class="mt-3 text-zinc-600">
                  You're now on the staff of {{ result.orgName }} as
                  <span class="font-semibold capitalize">{{ result.role }}</span
                  >.
                </p>
                <a
                  routerLink="/dashboard"
                  class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Go to the dashboard
                </a>
              </section>
            }
          }

          @case ('ready') {
            @if (invite(); as currentInvite) {
              <section class="py-8">
                <p class="text-sm font-medium text-indigo-600">Invitation</p>
                <h1
                  class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                >
                  Join {{ currentInvite.orgName }}
                </h1>
                <p class="mt-3 text-zinc-600">
                  You've been invited to help run events for
                  {{ currentInvite.orgName }} on Upskills Network.
                </p>

                <dl class="mt-8 space-y-4">
                  <div
                    class="flex items-center justify-between rounded-xl border border-zinc-200 p-4"
                  >
                    <dt class="text-sm font-medium text-zinc-500">Organizer</dt>
                    <dd class="text-sm font-semibold text-zinc-900">
                      {{ currentInvite.orgName }}
                    </dd>
                  </div>

                  <div
                    class="flex items-center justify-between rounded-xl border border-zinc-200 p-4"
                  >
                    <dt class="text-sm font-medium text-zinc-500">Your role</dt>
                    <dd
                      class="text-sm font-semibold capitalize text-zinc-900"
                      id="invite-role"
                    >
                      {{ currentInvite.role }}
                    </dd>
                  </div>

                  <div
                    class="flex items-center justify-between rounded-xl border border-zinc-200 p-4"
                  >
                    <dt class="text-sm font-medium text-zinc-500">Sent to</dt>
                    <dd class="text-sm font-semibold text-zinc-900">
                      {{ currentInvite.email }}
                    </dd>
                  </div>
                </dl>

                <p class="mt-6 text-sm text-zinc-600">
                  Sign in as {{ currentInvite.email }} to accept. Nothing is
                  shared with the organizer until you do.
                </p>

                <button
                  type="button"
                  [disabled]="submitting()"
                  (click)="accept()"
                  class="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Accept invitation
                </button>

                <a
                  [routerLink]="['/auth/login']"
                  [queryParams]="{ redirectTo: returnUrl() }"
                  class="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Sign in first
                </a>

                @if (acceptError(); as message) {
                  <div class="mt-6" role="alert">
                    <p
                      class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
                    >
                      {{ message }}
                    </p>
                  </div>
                }
              </section>
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class InviteAcceptPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly submitting = signal(false);
  readonly acceptError = signal<string | null>(null);

  private token = '';

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';

    if (this.token === '') {
      this.state.set({ status: 'not-found' });
      return;
    }

    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<InviteDetailResponse>(inviteDetailEndpoint(this.token), {
          withCredentials: true,
        }),
      );

      this.state.set({ status: 'ready', invite: response.invite });
    } catch (error) {
      this.state.set(this.describeLoadFailure(error));
    }
  }

  async accept(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.acceptError.set(null);

    try {
      const result = await firstValueFrom(
        this.http.post<InviteAcceptResponse>(
          inviteAcceptEndpoint(this.token),
          {},
          { withCredentials: true },
        ),
      );

      this.state.set({ status: 'accepted', result });
    } catch (error) {
      this.acceptError.set(this.describeAcceptFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }

  invite(): InviteDetailResponse['invite'] | null {
    const state = this.state();
    return state.status === 'ready' ? state.invite : null;
  }

  accepted(): InviteAcceptResponse | null {
    const state = this.state();
    return state.status === 'accepted' ? state.result : null;
  }

  unusableMessage(): string {
    const state = this.state();
    return state.status === 'unusable' ? state.message : '';
  }

  /** Where the login page should send the visitor back to. */
  returnUrl(): string {
    return `/invites/${encodeURIComponent(this.token)}`;
  }

  private describeLoadFailure(error: unknown): PageState {
    const status = apiErrorStatus(error);

    if (status === 404) {
      return { status: 'not-found' };
    }

    if (status === 409) {
      return {
        status: 'unusable',
        message:
          'This invitation has already been used, was withdrawn, or has expired. Ask an organizer to send a new one.',
      };
    }

    return { status: 'error' };
  }

  private describeAcceptFailure(error: unknown): string {
    const code = apiErrorCode(error);
    const status = apiErrorStatus(error);

    if (status === 401) {
      return 'Sign in with the invited email address to accept this invitation.';
    }

    if (code === 'invite-email-mismatch') {
      return 'This invitation was sent to a different email address. Sign in as that address to accept it.';
    }

    if (code === 'invite-not-pending') {
      return 'This invitation has already been used, was withdrawn, or has expired.';
    }

    if (code === 'invite-not-found') {
      return 'This invitation no longer exists.';
    }

    return 'Something went wrong while accepting the invitation. Please try again.';
  }
}
