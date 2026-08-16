import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { firstValueFrom } from 'rxjs';

import { authGuard } from '../../auth/auth-guard';
import {
  dashboardEventsEndpoint,
  dashboardOrgCreateEndpoint,
  dashboardOrgDetailEndpoint,
  dashboardOrgMembersEndpoint,
  meEndpoint,
  type DashboardEventsListResponse,
  type DashboardOrg,
  type DashboardOrgMembership,
  type DashboardOrgMembersRemoveResponse,
  type DashboardOrgMembersSetResponse,
  type DashboardOrgsCreateResponse,
  type DashboardOrgsDetailResponse,
  type MeGetResponse,
  type MeOrg,
  type MeUser,
  type DashboardEvent,
} from '../../dashboard/dashboard-api';
import { apiErrorCode, apiErrorStatus } from '../../events/event-api';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

/**
 * `/dashboard` — the organizer overview.
 *
 * Reads `orgs[0]` from `/api/v1/auth/me` and deliberately does not offer any
 * org switching: that is #65. The org detail and event routes are only called
 * when there is an org to ask about, because the dashboard routes require a
 * real org id and would otherwise answer 400 for the no-org state.
 *
 * When there is no org, the page offers a create-org form instead of a dead
 * end. `POST /api/v1/dashboard/orgs` takes `createdBy` from the session, so the
 * form sends only `name` and `slug`.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'no-orgs' }
  | { status: 'error' }
  | {
      status: 'ready';
      user: MeUser;
      org: MeOrg;
      dashboardOrg: DashboardOrg;
      events: DashboardEvent[];
    };

/** One roster row, with the map key (`uid`) promoted to a field. */
interface MemberRow {
  uid: string;
  role: DashboardOrgMembership['role'];
}

const ORG_ROLES: readonly DashboardOrgMembership['role'][] = [
  'admin',
  'manager',
  'check_in',
  'volunteer',
];

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-dashboard-overview-page',
  imports: [FormsModule, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">
              Loading dashboard…
            </p>
          }

          @case ('no-orgs') {
            <section class="mx-auto max-w-lg py-12">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Create your organizer
              </h1>
              <p class="mt-3 text-zinc-600">
                Your account is not a member of an organizer yet. Create one to
                start publishing events.
              </p>

              <form class="mt-8 grid grid-cols-1 gap-6">
                <div>
                  <label
                    for="org-name"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Name
                  </label>
                  <input
                    id="org-name"
                    name="name"
                    type="text"
                    required
                    maxlength="120"
                    [(ngModel)]="createForm.name"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label
                    for="org-slug"
                    class="block text-sm font-medium leading-6 text-zinc-900"
                  >
                    Slug
                  </label>
                  <input
                    id="org-slug"
                    name="slug"
                    type="text"
                    required
                    pattern="[a-z0-9-]+"
                    [(ngModel)]="createForm.slug"
                    class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                  <p class="mt-1 text-xs text-zinc-500">
                    Lowercase letters, numbers, and hyphens only.
                  </p>
                </div>

                @if (createError(); as message) {
                  <div role="alert">
                    <p
                      class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
                    >
                      {{ message }}
                    </p>
                  </div>
                }

                <button
                  type="button"
                  [disabled]="submittingCreate()"
                  (click)="createOrg()"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create organizer
                </button>
              </form>
            </section>
          }

          @case ('error') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load the dashboard. Please refresh to try again.
              </p>
            </section>
          }

          @case ('ready') {
            @if (org(); as currentOrg) {
              <div class="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p class="text-sm font-medium text-indigo-600">
                    Organizer dashboard
                  </p>
                  <h1
                    class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                  >
                    {{ currentOrg.name }}
                  </h1>
                  <p class="mt-2 text-sm text-zinc-600">
                    Signed in as {{ displayName() }} · {{ currentOrg.role }}
                  </p>
                </div>

                <a
                  href="/dashboard/events"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  View events
                </a>
              </div>

              @if (dashboardOrg(); as currentDashboardOrg) {
                <section class="mt-10" aria-labelledby="org-settings-heading">
                  <h2
                    id="org-settings-heading"
                    class="text-lg font-semibold text-zinc-900"
                  >
                    Organizer settings
                  </h2>

                  <dl class="mt-4 grid gap-4 sm:grid-cols-2">
                    <div class="rounded-xl border border-zinc-200 p-4">
                      <dt class="text-sm font-medium text-zinc-500">Name</dt>
                      <dd
                        id="dashboard-org-name"
                        class="mt-1 font-semibold text-zinc-900"
                      >
                        {{ currentDashboardOrg.name }}
                      </dd>
                    </div>

                    <div class="rounded-xl border border-zinc-200 p-4">
                      <dt class="text-sm font-medium text-zinc-500">Slug</dt>
                      <dd
                        id="dashboard-org-slug"
                        class="mt-1 font-semibold text-zinc-900"
                      >
                        {{ currentDashboardOrg.slug }}
                      </dd>
                    </div>
                  </dl>

                  <h3 class="mt-8 text-base font-semibold text-zinc-900">
                    Members
                  </h3>

                  <div
                    class="mt-4 overflow-x-auto rounded-xl border border-zinc-200"
                  >
                    <table
                      class="min-w-full divide-y divide-zinc-200 text-left"
                    >
                      <thead class="bg-zinc-50">
                        <tr>
                          <th
                            scope="col"
                            class="px-4 py-3 text-sm font-semibold text-zinc-900"
                          >
                            UID
                          </th>
                          <th
                            scope="col"
                            class="px-4 py-3 text-sm font-semibold text-zinc-900"
                          >
                            Role
                          </th>
                          @if (isAdmin()) {
                            <th
                              scope="col"
                              class="px-4 py-3 text-sm font-semibold text-zinc-900"
                            >
                              Actions
                            </th>
                          }
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-zinc-100">
                        @for (member of members(); track member.uid) {
                          <tr>
                            <td class="px-4 py-3 text-zinc-900">
                              {{ member.uid }}
                            </td>
                            <td class="px-4 py-3 text-zinc-700">
                              @if (isAdmin()) {
                                <select
                                  [value]="member.role"
                                  (change)="onRoleChange(member.uid, $event)"
                                  class="rounded-lg border-0 bg-white px-3 py-1.5 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                                >
                                  @for (role of roles; track role) {
                                    <option [value]="role">{{ role }}</option>
                                  }
                                </select>
                              } @else {
                                <span class="capitalize">{{
                                  member.role
                                }}</span>
                              }
                            </td>
                            @if (isAdmin()) {
                              <td class="px-4 py-3">
                                <button
                                  type="button"
                                  [disabled]="submittingMember()"
                                  (click)="removeMember(member.uid)"
                                  class="text-sm font-medium text-red-600 transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>

                  @if (isAdmin()) {
                    <div
                      class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <div>
                        <label
                          for="member-uid"
                          class="block text-sm font-medium leading-6 text-zinc-900"
                        >
                          Member uid
                        </label>
                        <input
                          id="member-uid"
                          name="uid"
                          type="text"
                          required
                          [(ngModel)]="memberForm.uid"
                          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label
                          for="member-role"
                          class="block text-sm font-medium leading-6 text-zinc-900"
                        >
                          Role
                        </label>
                        <select
                          id="member-role"
                          name="role"
                          [(ngModel)]="memberForm.role"
                          class="mt-2 block w-full rounded-lg border-0 bg-white px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        >
                          @for (role of roles; track role) {
                            <option [value]="role">{{ role }}</option>
                          }
                        </select>
                      </div>

                      <div class="sm:self-end">
                        <button
                          type="button"
                          [disabled]="submittingMember()"
                          (click)="addMember()"
                          class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Add member
                        </button>
                      </div>
                    </div>

                    @if (memberNotice(); as message) {
                      <div class="mt-6" role="status">
                        <p
                          class="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-200"
                        >
                          {{ message }}
                        </p>
                      </div>
                    }

                    @if (memberError(); as message) {
                      <div class="mt-6" role="alert">
                        <p
                          class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
                        >
                          {{ message }}
                        </p>
                      </div>
                    }
                  }
                </section>
              }

              <section class="mt-10" aria-labelledby="event-counts-heading">
                @if (events().length === 0) {
                  <div
                    class="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center"
                  >
                    <h2 class="text-lg font-semibold text-zinc-900">
                      No events yet
                    </h2>
                    <p class="mt-2 text-sm text-zinc-600">
                      This organizer hasn't created any events yet.
                    </p>
                  </div>
                }

                <h2
                  id="event-counts-heading"
                  class="mt-8 text-lg font-semibold text-zinc-900"
                >
                  Events by status
                </h2>

                <dl class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Draft</dt>
                    <dd
                      id="dashboard-draft-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('draft') }}
                    </dd>
                  </div>

                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Published</dt>
                    <dd
                      id="dashboard-published-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('published') }}
                    </dd>
                  </div>

                  <div class="rounded-xl border border-zinc-200 p-4">
                    <dt class="text-sm font-medium text-zinc-500">Cancelled</dt>
                    <dd
                      id="dashboard-cancelled-count"
                      class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                    >
                      {{ count('cancelled') }}
                    </dd>
                  </div>
                </dl>
              </section>
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class DashboardOverviewPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly submittingCreate = signal(false);
  readonly createError = signal<string | null>(null);
  readonly submittingMember = signal(false);
  readonly memberError = signal<string | null>(null);
  readonly memberNotice = signal<string | null>(null);

  readonly roles = ORG_ROLES;
  readonly createForm = { name: '', slug: '' };
  readonly memberForm: { uid: string; role: DashboardOrgMembership['role'] } = {
    uid: '',
    role: 'manager',
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

      const [orgDetail, events] = await Promise.all([
        firstValueFrom(
          this.http.get<DashboardOrgsDetailResponse>(
            dashboardOrgDetailEndpoint(org.orgId),
            { withCredentials: true },
          ),
        ),
        firstValueFrom(
          this.http.get<DashboardEventsListResponse>(
            dashboardEventsEndpoint(org.orgId),
            { withCredentials: true },
          ),
        ),
      ]);

      this.state.set({
        status: 'ready',
        user: me.user,
        org,
        dashboardOrg: orgDetail.org,
        events: events.events,
      });
    } catch {
      this.state.set({ status: 'error' });
    }
  }

  async createOrg(): Promise<void> {
    if (this.submittingCreate()) {
      return;
    }

    this.submittingCreate.set(true);
    this.createError.set(null);

    try {
      await firstValueFrom(
        this.http.post<DashboardOrgsCreateResponse>(
          dashboardOrgCreateEndpoint(),
          {
            name: this.createForm.name.trim(),
            slug: this.createForm.slug.trim(),
          },
          { withCredentials: true },
        ),
      );

      await this.load();
    } catch (error) {
      this.createError.set(this.describeCreateError(error));
    } finally {
      this.submittingCreate.set(false);
    }
  }

  async addMember(): Promise<void> {
    if (this.submittingMember()) {
      return;
    }

    const state = this.state();
    if (state.status !== 'ready') {
      return;
    }

    this.submittingMember.set(true);
    this.memberError.set(null);
    this.memberNotice.set(null);

    try {
      await firstValueFrom(
        this.http.post<DashboardOrgMembersSetResponse>(
          dashboardOrgMembersEndpoint(state.org.orgId),
          {
            uid: this.memberForm.uid.trim(),
            role: this.memberForm.role,
          },
          { withCredentials: true },
        ),
      );

      this.memberForm.uid = '';
      await this.load();
      this.memberNotice.set('Member added.');
    } catch (error) {
      this.memberError.set(this.describeMemberError(error));
    } finally {
      this.submittingMember.set(false);
    }
  }

  async changeRole(uid: string, role: string): Promise<void> {
    if (this.submittingMember()) {
      return;
    }

    const state = this.state();
    if (state.status !== 'ready') {
      return;
    }

    this.submittingMember.set(true);
    this.memberError.set(null);
    this.memberNotice.set(null);

    try {
      await firstValueFrom(
        this.http.put<DashboardOrgMembersSetResponse>(
          dashboardOrgMembersEndpoint(state.org.orgId),
          { uid, role },
          { withCredentials: true },
        ),
      );

      await this.load();
      this.memberNotice.set('Member role updated.');
    } catch (error) {
      this.memberError.set(this.describeMemberError(error));
    } finally {
      this.submittingMember.set(false);
    }
  }

  onRoleChange(uid: string, event: Event): void {
    void this.changeRole(uid, (event.target as HTMLSelectElement).value);
  }

  async removeMember(uid: string): Promise<void> {
    if (this.submittingMember()) {
      return;
    }

    const state = this.state();
    if (state.status !== 'ready') {
      return;
    }

    if (!window.confirm('Remove this member from the organizer?')) {
      return;
    }

    this.submittingMember.set(true);
    this.memberError.set(null);
    this.memberNotice.set(null);

    try {
      await firstValueFrom(
        this.http.delete<DashboardOrgMembersRemoveResponse>(
          dashboardOrgMembersEndpoint(state.org.orgId),
          { body: { uid }, withCredentials: true },
        ),
      );

      await this.load();
      this.memberNotice.set('Member removed.');
    } catch (error) {
      this.memberError.set(this.describeMemberError(error));
    } finally {
      this.submittingMember.set(false);
    }
  }

  user(): MeUser | null {
    const state = this.state();
    return state.status === 'ready' ? state.user : null;
  }

  org(): MeOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  dashboardOrg(): DashboardOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.dashboardOrg : null;
  }

  events(): DashboardEvent[] {
    const state = this.state();
    return state.status === 'ready' ? state.events : [];
  }

  members(): MemberRow[] {
    const org = this.dashboardOrg();

    if (org === null) {
      return [];
    }

    return Object.entries(org.members)
      .map(([uid, membership]) => ({ uid, role: membership.role }))
      .sort((left, right) => left.uid.localeCompare(right.uid));
  }

  isAdmin(): boolean {
    return this.org()?.role === 'admin';
  }

  displayName(): string {
    const user = this.user();

    if (user === null) {
      return '';
    }

    return user.name === undefined || user.name === '' ? user.email : user.name;
  }

  count(status: DashboardEvent['status']): number {
    return this.events().filter((workshop) => workshop.status === status)
      .length;
  }

  private describeCreateError(error: unknown): string {
    const code = apiErrorCode(error);

    if (code === 'slug-taken') {
      return 'That slug is already taken. Choose a different slug.';
    }

    if (code === 'invalid-slug') {
      return 'That slug is not usable. Use lowercase letters, numbers, and hyphens only.';
    }

    if (code === 'org-limit-exceeded') {
      return 'You already belong to an organizer.';
    }

    if (apiErrorStatus(error) === 400) {
      return 'The organizer could not be created. Check the form and try again.';
    }

    return 'Something went wrong while creating the organizer. Please try again.';
  }

  private describeMemberError(error: unknown): string {
    const code = apiErrorCode(error);

    if (code === 'last-org-admin') {
      return 'An organizer must keep at least one admin.';
    }

    if (code === 'org-not-found') {
      return 'That organizer no longer exists.';
    }

    if (apiErrorStatus(error) === 400) {
      return 'Check the member uid and role and try again.';
    }

    return 'Something went wrong while updating members. Please try again.';
  }
}
