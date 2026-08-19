import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../../../../auth/auth-guard';
import {
  dashboardEventDetailEndpoint,
  dashboardEventUpdateEndpoint,
  meEndpoint,
  type DashboardEvent,
  type DashboardEventsDetailResponse,
  type DashboardEventsUpdateResponse,
  type MeGetResponse,
  type MeOrg,
} from '../../../../../dashboard/dashboard-api';
import { apiErrorStatus } from '../../../../../events/event-api';
import { LandingFooterComponent } from '../../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../../landing/landing-header.component';
import { dollarsToCents, toIsoWithOffset } from '../../new/index.page';

/**
 * `/dashboard/events/[eventId]/edit` — edit one event for the caller's first org.
 *
 * Mirrors the create page's org handling: read `orgs[0]` from
 * `/api/v1/auth/me` and offer no org switching (#65). The detail route answers
 * 403 for a missing event and an event the caller cannot edit alike, so a 403
 * here is rendered as "not found or you can't edit it" rather than a retry
 * prompt.
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

interface EditEventForm {
  title: string;
  slug: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string;
  /** Absolute https URL of a hero image. Cleared by emptying the field. */
  imageUrl: string;
  /** Entered in dollars, e.g. `49.50`. Converted to cents before posting. */
  price: string;
  maxGuests: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'cancelled' }
  | { status: 'error' }
  | { status: 'ready'; org: MeOrg; workshop: DashboardEvent };

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

/**
 * `2026-09-10T13:30:00.000Z` + `America/Toronto` → `2026-09-10T09:30`.
 *
 * The wire value is the UTC instant; a `datetime-local` input needs the wall
 * time in the event's own IANA zone. Slicing the first 16 characters would
 * return UTC wall time, which is wrong for every non-UTC zone.
 */
export function toLocalDatetimeValue(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));

  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** `4950` → `"49.50"`; integer cents to the dollars the price input edits. */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

@Component({
  selector: 'app-dashboard-events-edit-page',
  imports: [FormsModule, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-3xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">Loading event…</p>
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
              <p class="mt-3 text-zinc-600">
                We couldn't load this event. Please refresh to try again.
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
                    Edit event
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
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                  <p class="mt-1 text-xs text-zinc-500">
                    Lowercase letters, numbers, and hyphens only.
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
                    Optional. Must start with https://. Clear the field to
                    remove the image.
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
                    (click)="save('draft')"
                    class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save as draft
                  </button>
                  <button
                    type="button"
                    [disabled]="submitting()"
                    (click)="save('published')"
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
export default class DashboardEventsEditPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly timezones = CANADIAN_TIME_ZONES;

  readonly form: EditEventForm = {
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

      this.prefill(response.event);
      this.state.set({ status: 'ready', org, workshop: response.event });
    } catch (error) {
      this.state.set({
        status: apiErrorStatus(error) === 403 ? 'not-found' : 'error',
      });
    }
  }

  private prefill(workshop: DashboardEvent): void {
    this.form.title = workshop.title;
    this.form.slug = workshop.slug;
    this.form.description = workshop.description;
    this.form.startsAt = toLocalDatetimeValue(
      workshop.startsAt,
      workshop.timezone,
    );
    this.form.endsAt =
      workshop.endsAt === undefined
        ? ''
        : toLocalDatetimeValue(workshop.endsAt, workshop.timezone);
    this.form.timezone = workshop.timezone;
    this.form.location = workshop.location ?? '';
    this.form.imageUrl = workshop.imageUrl ?? '';
    this.form.price = centsToDollars(workshop.price);
    this.form.maxGuests = String(workshop.maxGuests);
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  async save(status: 'draft' | 'published'): Promise<void> {
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
      await firstValueFrom(
        this.http.put<DashboardEventsUpdateResponse>(
          dashboardEventUpdateEndpoint(
            state.workshop.orgId,
            state.workshop.eventId,
          ),
          this.buildBody(status),
          { withCredentials: true },
        ),
      );

      await this.router.navigateByUrl('/dashboard/events');
    } catch (error) {
      this.submitError.set(this.describeSubmitError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private buildBody(status: 'draft' | 'published'): Record<string, unknown> {
    const endsAt = this.form.endsAt.trim();
    const location = this.form.location.trim();

    return {
      title: this.form.title.trim(),
      slug: this.form.slug.trim(),
      description: this.form.description.trim(),
      startsAt: toIsoWithOffset(this.form.startsAt, this.form.timezone),
      ...(endsAt === ''
        ? {}
        : { endsAt: toIsoWithOffset(endsAt, this.form.timezone) }),
      timezone: this.form.timezone,
      // Both always sent, empty string included, because this is an *edit*:
      // omitting a field means "leave it as it was", so an emptied input that
      // is then omitted silently keeps the old value — the field looks cleared
      // on screen and is not cleared in the database. The empty string is what
      // says "remove it", and `applyOptionalText` in `events-write.ts` deletes
      // the key rather than storing `''`.
      //
      // The create form is different, and correctly omits both: there is no
      // previous value there for an absent field to preserve.
      location,
      imageUrl: this.form.imageUrl.trim(),
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
      return 'The event could not be updated. Check the form and try again.';
    }

    return 'Something went wrong while updating the event. Please try again.';
  }
}
