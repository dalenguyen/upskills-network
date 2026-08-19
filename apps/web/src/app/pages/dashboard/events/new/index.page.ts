import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { Router } from '@angular/router';
import { nextSlugCandidate, slugify } from '@upskills/validation';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../../auth/auth-guard';
import {
  dashboardEventCreateEndpoint,
  meEndpoint,
  type DashboardEventsCreateResponse,
  type MeGetResponse,
  type MeOrg,
} from '../../../../dashboard/dashboard-api';
import { apiErrorStatus } from '../../../../events/event-api';
import { LandingFooterComponent } from '../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../landing/landing-header.component';

/**
 * How many slugs to try before giving up and reporting the collision.
 *
 * Small on purpose. This exists to absorb "two events with the same obvious
 * name", which is one or two retries in practice; a page that quietly tried
 * fifty would be papering over a naming problem the organizer should see.
 */
const MAX_SLUG_ATTEMPTS = 5;

/**
 * `/dashboard/events/new` — create an event for the caller's first org.
 *
 * Mirrors the list page's load: read `orgs[0]` from `/api/v1/auth/me` and
 * offer no org switching (#65). Only `admin` and `manager` members may create
 * events, because those are the only roles the server route accepts, so the
 * page shows a permission message instead of a form that would 403.
 */

const CANADIAN_TIME_ZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'UTC',
] as const;

interface CreateEventForm {
  title: string;
  slug: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string;
  /** Absolute https URL of a hero image. Empty means the event has none. */
  imageUrl: string;
  /** Entered in dollars, e.g. `49.50`. Converted to cents before posting. */
  price: string;
  maxGuests: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; org: MeOrg };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

/** `2026-09-01T18:00` + `America/Toronto` → `2026-09-01T18:00:00-04:00`. */
export function toIsoWithOffset(localValue: string, timeZone: string): string {
  const asUtc = new Date(`${localValue}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(asUtc);
  const name =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  const offset = match ? `${match[1]}${match[2]}:${match[3]}` : '+00:00';
  return `${localValue}:00${offset}`;
}

/** `49.50` → `4950`; `19.99` → `1999` rather than `1998.9999…`. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

@Component({
  selector: 'app-dashboard-events-new-page',
  imports: [FormsModule, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-3xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">Loading…</p>
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
              <p class="mt-3 text-zinc-600">
                We couldn't load this page. Please refresh to try again.
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

              <form
                class="mt-10 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2"
              >
                <div class="sm:col-span-2">
                  <label
                    for="title"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Title
                  </label>
                  <input
                    id="title"
                    name="title"
                    type="text"
                    required
                    maxlength="200"
                    [(ngModel)]="form.title"
                    (ngModelChange)="onTitleChange()"
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
                    Lowercase letters, numbers, and hyphens only. Filled in from
                    the title until you edit it.
                  </p>
                </div>

                <div>
                  <label
                    for="timezone"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Timezone
                  </label>
                  <select
                    id="timezone"
                    name="timezone"
                    required
                    [(ngModel)]="form.timezone"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  >
                    @for (zone of timezones; track zone) {
                      <option [value]="zone">{{ zone }}</option>
                    }
                  </select>
                </div>

                <div class="sm:col-span-2">
                  <label
                    for="description"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Description
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    rows="4"
                    maxlength="5000"
                    [(ngModel)]="form.description"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  ></textarea>
                </div>

                <div>
                  <label
                    for="startsAt"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Starts at
                  </label>
                  <input
                    id="startsAt"
                    name="startsAt"
                    type="datetime-local"
                    required
                    [(ngModel)]="form.startsAt"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="endsAt"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Ends at
                  </label>
                  <input
                    id="endsAt"
                    name="endsAt"
                    type="datetime-local"
                    [(ngModel)]="form.endsAt"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="location"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Location
                  </label>
                  <input
                    id="location"
                    name="location"
                    type="text"
                    maxlength="300"
                    [(ngModel)]="form.location"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="imageUrl"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Image URL
                  </label>
                  <input
                    id="imageUrl"
                    name="imageUrl"
                    type="url"
                    maxlength="2000"
                    placeholder="https://example.com/poster.jpg"
                    [(ngModel)]="form.imageUrl"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                  <p class="mt-2 text-xs text-zinc-500">
                    Optional. Must start with https://. Link an image you host —
                    if it stops loading, the event simply shows without one.
                  </p>
                </div>

                <div>
                  <label
                    for="price"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Price (CAD)
                  </label>
                  <input
                    id="price"
                    name="price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    [(ngModel)]="form.price"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="maxGuests"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Max guests
                  </label>
                  <input
                    id="maxGuests"
                    name="maxGuests"
                    type="number"
                    required
                    min="0"
                    step="1"
                    [(ngModel)]="form.maxGuests"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                  <p class="mt-1 text-xs text-zinc-500">
                    Enter 0 for an unlimited event.
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

                <div
                  class="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end"
                >
                  <button
                    type="button"
                    [disabled]="submitting()"
                    (click)="create('draft')"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save as draft
                  </button>
                  <button
                    type="button"
                    [disabled]="submitting()"
                    (click)="create('published')"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Publish
                  </button>
                </div>
              </form>
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
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly timezones = CANADIAN_TIME_ZONES;

  /**
   * Whether the organizer has edited the slug field themselves.
   *
   * Plain field rather than a signal: nothing renders from it, it only gates
   * {@link onTitleChange} and the retry loop.
   */
  protected slugTouched = false;

  readonly form: CreateEventForm = {
    title: '',
    slug: '',
    description: '',
    startsAt: '',
    endsAt: '',
    timezone: 'America/Toronto',
    location: '',
    imageUrl: '',
    price: '0',
    maxGuests: '0',
  };

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
    } catch {
      this.state.set({ status: 'error' });
    }
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  async create(status: 'draft' | 'published'): Promise<void> {
    if (this.submitting()) {
      return;
    }

    const state = this.state();
    if (state.status !== 'ready') {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      await this.postWithFreeSlug(state.org.orgId, status);
      await this.router.navigateByUrl('/dashboard/events');
    } catch (error) {
      this.submitError.set(this.describeSubmitError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Keep the slug in step with the title, until the organizer takes it over.
   *
   * Deriving it is the whole point — nobody wants to type `react-basics` after
   * typing `React Basics` — but silently rewriting a slug somebody has chosen
   * would be worse than not helping at all. {@link slugTouched} is the line
   * between the two, and it is one-way: once they edit the field, the title
   * stops driving it for the rest of the form's life.
   */
  protected onTitleChange(): void {
    if (!this.slugTouched) {
      this.form.slug = slugify(this.form.title);
    }
  }

  /**
   * POST the event, walking the slug forward while the server says it is taken.
   *
   * The server is the only authority on whether a slug is free — a check before
   * the write is a guess that goes stale — so this asks, and asks again with
   * `-2`, `-3` when the answer is 409. That turns the common case (two events
   * with the same obvious name, in the same org) from an error the organizer has
   * to resolve by hand into something they never see.
   *
   * The retries stop after {@link MAX_SLUG_ATTEMPTS}, and only ever on a 409:
   * any other failure is rethrown immediately rather than retried into a
   * different slug. The final 409 is rethrown too, so a genuinely stuck slug
   * still reports honestly instead of failing silently.
   *
   * A slug the organizer typed themselves is **not** walked forward. They asked
   * for that specific name; answering "taken" is the correct response, and
   * quietly filing their event under a different URL is not.
   */
  private async postWithFreeSlug(
    orgId: string,
    status: 'draft' | 'published',
  ): Promise<void> {
    const base = this.form.slug.trim();
    const attempts = this.slugTouched ? 1 : MAX_SLUG_ATTEMPTS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const slug = nextSlugCandidate(base, attempt);

      try {
        await firstValueFrom(
          this.http.post<DashboardEventsCreateResponse>(
            dashboardEventCreateEndpoint(orgId),
            { ...this.buildBody(status), slug },
            { withCredentials: true },
          ),
        );

        // Reflect what was actually taken, so a failure later in this session
        // does not show the organizer a slug their event does not have.
        this.form.slug = slug;
        return;
      } catch (error) {
        if (attempt === attempts || apiErrorStatus(error) !== 409) {
          throw error;
        }
      }
    }
  }

  private buildBody(status: 'draft' | 'published'): Record<string, unknown> {
    const endsAt = this.form.endsAt.trim();
    const location = this.form.location.trim();
    const imageUrl = this.form.imageUrl.trim();

    return {
      title: this.form.title.trim(),
      slug: this.form.slug.trim(),
      description: this.form.description.trim(),
      startsAt: toIsoWithOffset(this.form.startsAt, this.form.timezone),
      ...(endsAt === ''
        ? {}
        : { endsAt: toIsoWithOffset(endsAt, this.form.timezone) }),
      timezone: this.form.timezone,
      ...(location === '' ? {} : { location }),
      ...(imageUrl === '' ? {} : { imageUrl }),
      price: dollarsToCents(Number(this.form.price)),
      currency: 'cad',
      maxGuests: Number(this.form.maxGuests),
      status,
    };
  }

  private describeSubmitError(error: unknown): string {
    const status = (error as { status?: unknown }).status;

    if (status === 409) {
      return 'That slug is already taken. Choose a different slug.';
    }

    if (status === 400) {
      return 'The event could not be created. Check the form and try again.';
    }

    return 'Something went wrong while creating the event. Please try again.';
  }
}
