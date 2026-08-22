import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { slugify } from '@upskills/validation';
import { firstValueFrom } from 'rxjs';

import {
  adminOrgCreateEndpoint,
  adminOrgsEndpoint,
  type AdminOrg,
  type OrgsCreateResponse,
  type OrgsListResponse,
} from '../../../admin/orgs-api';
import { authGuard } from '../../../auth/auth-guard';
import { apiErrorCode, apiErrorStatus } from '../../../events/event-api';
import { LandingFooterComponent } from '../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../landing/landing-header.component';
import { LoadingStateComponent } from '../../../landing/loading-state.component';

/**
 * `/admin/orgs` — the platform-admin organizer index and create form.
 *
 * Loads the list straight from `/api/v1/admin/orgs`: there is no `/me`
 * prelude because the route checks the session itself. The create form posts
 * `{ name, slug }` and then reloads the list so the new organizer appears in
 * its server-assigned position without a page refresh.
 */

interface CreateOrgForm {
  name: string;
  slug: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; orgs: AdminOrg[] };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-admin-orgs-page',
  imports: [
    FormsModule,
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
            <app-loading-state label="Loading organizers…" />
          }

          @case ('forbidden') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                You don't have permission to view this page
              </h1>
              <p class="mt-3 text-zinc-600">
                Only platform admins can manage organizers.
              </p>
            </section>
          }

          @case ('error') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load these organizers. Please refresh to try again.
              </p>
            </section>
          }

          @case ('ready') {
            <div class="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p class="text-sm font-medium text-indigo-600">
                  Platform admin
                </p>
                <h1
                  class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                >
                  Organizers
                </h1>
              </div>
            </div>

            @if (orgs().length === 0) {
              <section
                class="mt-8 rounded-xl border border-dashed border-zinc-300 py-12 text-center"
              >
                <h2 class="text-lg font-semibold text-zinc-900">
                  No organizers yet
                </h2>
                <p class="mt-2 text-sm text-zinc-600">
                  Create the first organizer below.
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
                        Slug
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-100">
                    @for (org of orgs(); track org.orgId) {
                      <tr>
                        <td class="px-4 py-3">
                          <a
                            [href]="'/admin/orgs/' + org.orgId"
                            class="font-medium text-indigo-600 transition hover:text-indigo-500"
                          >
                            {{ org.name }}
                          </a>
                        </td>
                        <td class="px-4 py-3 text-zinc-700">{{ org.slug }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            <section class="mt-12" aria-labelledby="create-org-heading">
              <h2
                id="create-org-heading"
                class="text-lg font-semibold text-zinc-900"
              >
                Create organizer
              </h2>

              <form
                class="mt-6 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2"
              >
                <div>
                  <label
                    for="name"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    maxlength="200"
                    [(ngModel)]="form.name"
                    (ngModelChange)="onOrgNameChange()"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="slug"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Slug
                  </label>
                  <input
                    id="slug"
                    name="slug"
                    type="text"
                    required
                    pattern="[a-z0-9-]+"
                    [(ngModel)]="form.slug"
                    (ngModelChange)="slugTouched = true"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                  <p class="mt-1 text-xs text-zinc-500">
                    Lowercase letters, numbers, and hyphens only.
                  </p>
                </div>

                @if (submitError(); as message) {
                  <div class="sm:col-span-2" role="alert">
                    <p
                      class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
                    >
                      {{ message }}
                    </p>
                  </div>
                }

                <div class="flex sm:col-span-2 sm:justify-end">
                  <button
                    type="button"
                    [disabled]="submitting()"
                    (click)="create()"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Create organizer
                  </button>
                </div>
              </form>
            </section>
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class AdminOrgsPageComponent implements OnInit {
  /**
   * Whether the operator has edited the org slug themselves. One-way: once they
   * touch it, the name stops driving it.
   */
  protected slugTouched = false;

  /**
   * Derive the org slug from the name, until it is edited by hand.
   *
   * Unlike the event form, this never walks the slug forward to `-2` on a
   * collision. An organizer slug is the front of every URL they own — it is
   * identity, not a convenience — so "that one is taken" is the right answer to
   * give a human, not something to silently work around.
   */
  protected onOrgNameChange(): void {
    if (!this.slugTouched) {
      this.form.slug = slugify(this.form.name);
    }
  }
  private readonly http = inject(HttpClient);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly form: CreateOrgForm = {
    name: '',
    slug: '',
  };

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<OrgsListResponse>(adminOrgsEndpoint(), {
          withCredentials: true,
        }),
      );

      this.state.set({ status: 'ready', orgs: response.orgs });
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
        status: apiErrorStatus(error) === 403 ? 'forbidden' : 'error',
      });
    }
  }

  orgs(): AdminOrg[] {
    const state = this.state();
    return state.status === 'ready' ? state.orgs : [];
  }

  async create(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      await firstValueFrom(
        this.http.post<OrgsCreateResponse>(
          adminOrgCreateEndpoint(),
          {
            name: this.form.name.trim(),
            slug: this.form.slug.trim(),
          },
          { withCredentials: true },
        ),
      );
    } catch (error) {
      this.submitError.set(this.describeSubmitError(error));
      return;
    } finally {
      this.submitting.set(false);
    }

    this.form.name = '';
    this.form.slug = '';
    // Reset with the form: a slug edited by hand on the *previous* organizer
    // must not stop the next name from deriving one.
    this.slugTouched = false;
    await this.load();
  }

  private describeSubmitError(error: unknown): string {
    const code = apiErrorCode(error);

    if (code === 'slug-taken') {
      return 'That slug is already taken. Choose a different slug.';
    }

    if (code === 'invalid-slug') {
      return 'That slug is not usable. Lowercase letters, numbers, and hyphens only.';
    }

    if (code === 'org-limit-exceeded') {
      return 'Your account already belongs to an organizer, so it cannot create another one.';
    }

    const status = apiErrorStatus(error);

    if (status === 400) {
      return 'The organizer could not be created. Check the form and try again.';
    }

    if (status === 403) {
      return 'You do not have permission to create organizers.';
    }

    return 'Something went wrong while creating the organizer. Please try again.';
  }
}
