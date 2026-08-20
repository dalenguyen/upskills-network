import { HttpClient } from '@angular/common/http';
import { Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  dashboardEventCancelEndpoint,
  dashboardEventDeleteEndpoint,
  type DashboardEvent,
  type DashboardEventsCancelResponse,
} from '../dashboard/dashboard-api';
import { apiErrorCode, apiErrorStatus } from './event-api';

/**
 * The event table, shared by the organizer dashboard and the platform-admin
 * console.
 *
 * It owns the two destructive writes rather than leaving them to each host,
 * because they are what the rows are for: a table that emitted "cancel this"
 * would have every caller re-implement the confirm prompt, the notification
 * message, and the error text. Hosts reload their own data on {@link changed}.
 *
 * Editing is the opposite: the dashboard navigates to its own edit page and the
 * admin console edits inline, so {@link editLinkBase} chooses a link, and its
 * absence emits {@link edit} instead.
 */
@Component({
  selector: 'app-event-list',
  template: `
    @if (notice(); as message) {
      <div class="mt-6" role="status">
        <p
          class="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-200"
        >
          {{ message }}
        </p>
      </div>
    }

    @if (error(); as message) {
      <div class="mt-6" role="alert">
        <p
          class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
        >
          {{ message }}
        </p>
      </div>
    }

    @if (events().length === 0) {
      <section
        class="mt-12 rounded-xl border border-dashed border-zinc-300 py-12 text-center"
      >
        <h2 class="text-lg font-semibold text-zinc-900">No events yet</h2>
        <p class="mt-2 text-sm text-zinc-600">
          This organizer hasn't created any events yet.
        </p>
      </section>
    } @else {
      <div class="mt-8 overflow-x-auto rounded-xl border border-zinc-200">
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
                    [href]="publicEventPath(workshop)"
                    class="font-medium text-indigo-600 transition hover:text-indigo-500"
                  >
                    {{ workshop.title }}
                  </a>
                  @if (workshop.status !== 'cancelled') {
                    @if (editLinkBase(); as base) {
                      <a
                        [href]="base + '/' + workshop.eventId + '/edit'"
                        class="ml-3 text-sm font-medium text-zinc-500 transition hover:text-zinc-700"
                      >
                        Edit
                      </a>
                    } @else {
                      <button
                        type="button"
                        [disabled]="busy()"
                        (click)="edit.emit(workshop)"
                        class="ml-3 text-sm font-medium text-zinc-500 transition hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Edit
                      </button>
                    }
                  }
                  @if (
                    workshop.status === 'draft' ||
                    workshop.status === 'published'
                  ) {
                    <button
                      type="button"
                      [disabled]="busy()"
                      (click)="cancel(workshop)"
                      class="ml-3 text-sm font-medium text-red-600 transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  }
                  @if (allowDelete() && workshop.status === 'draft') {
                    <button
                      type="button"
                      [disabled]="busy()"
                      (click)="remove(workshop)"
                      class="ml-3 text-sm font-medium text-red-600 transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete
                    </button>
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
  `,
})
export class EventListComponent {
  private readonly http = inject(HttpClient);

  readonly events = input.required<DashboardEvent[]>();

  /** The org that owns every row. Cancel and delete are keyed by it. */
  readonly orgId = input.required<string>();

  /** The org's public slug, for the `/{orgSlug}/{eventSlug}` title link. */
  readonly orgSlug = input.required<string>();

  /**
   * Where an event's edit page lives, e.g. `/dashboard/events`. `null` renders
   * an Edit button that emits {@link edit} instead — for hosts that edit inline.
   */
  readonly editLinkBase = input<string | null>(null);

  /** Whether to offer the permanent delete on draft rows. */
  readonly allowDelete = input(false);

  /** An event the host should open for editing. Only with no `editLinkBase`. */
  readonly edit = output<DashboardEvent>();

  /** Something was cancelled or deleted; the host should reload its events. */
  readonly changed = output<void>();

  readonly busy = signal(false);
  readonly notice = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** The public URL of one of this org's events: `/{orgSlug}/{eventSlug}`. */
  protected publicEventPath(workshop: DashboardEvent): string {
    return `/${encodeURIComponent(this.orgSlug())}/${encodeURIComponent(workshop.slug)}`;
  }

  async cancel(workshop: DashboardEvent): Promise<void> {
    if (this.busy()) {
      return;
    }

    if (!window.confirm('Cancel this event and notify confirmed guests?')) {
      return;
    }

    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.delete<DashboardEventsCancelResponse>(
          dashboardEventCancelEndpoint(this.orgId(), workshop.eventId),
          { withCredentials: true },
        ),
      );

      this.notice.set(this.notificationMessage(response.notification));
      this.changed.emit();
    } catch {
      this.error.set(
        'Something went wrong while cancelling the event. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Permanently delete a draft nobody registered for, freeing its slug.
   *
   * The server refuses anything else with 409 `event-not-deletable`, so the row
   * only offers this on drafts and the refusal is still reported honestly.
   */
  async remove(workshop: DashboardEvent): Promise<void> {
    if (this.busy()) {
      return;
    }

    if (
      !window.confirm(
        'Permanently delete this draft? This cannot be undone, and frees its slug.',
      )
    ) {
      return;
    }

    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);

    try {
      await firstValueFrom(
        this.http.delete(
          dashboardEventDeleteEndpoint(this.orgId(), workshop.eventId),
          { withCredentials: true },
        ),
      );

      this.notice.set('Event deleted. Its slug is free to use again.');
      this.changed.emit();
    } catch (error) {
      this.error.set(this.describeDeleteError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private describeDeleteError(error: unknown): string {
    if (apiErrorCode(error) === 'event-not-deletable') {
      return 'Only a draft with no registrations can be deleted. Cancel it instead.';
    }

    if (apiErrorStatus(error) === 403) {
      return 'You do not have permission to delete this event.';
    }

    return 'Something went wrong while deleting the event. Please try again.';
  }

  private notificationMessage(
    notification: DashboardEventsCancelResponse['notification'],
  ): string {
    if (notification.attempted === 0) {
      return 'Event cancelled. 0 guests to notify.';
    }

    if (notification.failed > 0) {
      return `Event cancelled. ${notification.sent} of ${notification.attempted} guests notified; ${notification.failed} could not be emailed.`;
    }

    return `Event cancelled. ${notification.sent} guests notified.`;
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
