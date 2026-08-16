import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  adminOrgDetailEndpoint,
  adminOrgMembersEndpoint,
  type AdminOrg,
  type OrgMembersRemoveResponse,
  type OrgMembersSetResponse,
  type OrgRole,
  type OrgsDetailResponse,
} from '../../../../admin/orgs-api';
import { authGuard } from '../../../../auth/auth-guard';
import { apiErrorCode, apiErrorStatus } from '../../../../events/event-api';
import { LandingFooterComponent } from '../../../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../../../landing/landing-header.component';

/**
 * `/admin/orgs/[orgId]` — one organizer's detail and member roster.
 *
 * The detail route answers the whole org document, so the page does not need a
 * separate roster request: `org.members` is already keyed by uid. Member writes
 * post back to `/api/v1/admin/orgs/:orgId/members` and each response carries
 * the updated org, which replaces the local state without a second fetch.
 */

interface MemberForm {
  uid: string;
  role: OrgRole;
}

interface MemberRow {
  uid: string;
  role: OrgRole;
}

type PageState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; org: AdminOrg };

/** Stable, uid-sorted roster rows so the per-row role selects keep their model. */
function toMemberRows(org: AdminOrg): MemberRow[] {
  return Object.entries(org.members)
    .map(([uid, membership]): MemberRow => ({
      uid,
      role: membership.role,
    }))
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-admin-org-detail-page',
  imports: [FormsModule, LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        @switch (state().status) {
          @case ('loading') {
            <p class="text-sm text-zinc-500" role="status">
              Loading organizer…
            </p>
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

          @case ('not-found') {
            <section class="mx-auto max-w-lg py-12 text-center">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                We couldn't find that organizer
              </h1>
              <p class="mt-3 text-zinc-600">
                It may have been removed, or you don't have permission to view
                it.
              </p>
              <a
                href="/admin/orgs"
                class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Back to organizers
              </a>
            </section>
          }

          @case ('error') {
            <section class="mx-auto max-w-lg py-12 text-center" role="alert">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
                Something went wrong
              </h1>
              <p class="mt-3 text-zinc-600">
                We couldn't load this organizer. Please refresh to try again.
              </p>
            </section>
          }

          @case ('ready') {
            @if (org(); as currentOrg) {
              <div class="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p class="text-sm font-medium text-indigo-600">
                    Platform admin
                  </p>
                  <h1
                    class="mt-1 text-3xl font-bold tracking-tight text-zinc-900"
                  >
                    {{ currentOrg.name }}
                  </h1>
                  <p class="mt-1 text-sm text-zinc-600">
                    {{ currentOrg.slug }}
                  </p>
                </div>

                <a
                  href="/admin/orgs"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Back to organizers
                </a>
              </div>

              <dl class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="rounded-xl border border-zinc-200 p-4">
                  <dt class="text-sm font-semibold text-zinc-900">Name</dt>
                  <dd class="mt-1 text-sm text-zinc-700">
                    {{ currentOrg.name }}
                  </dd>
                </div>

                <div class="rounded-xl border border-zinc-200 p-4">
                  <dt class="text-sm font-semibold text-zinc-900">Slug</dt>
                  <dd class="mt-1 text-sm text-zinc-700">
                    {{ currentOrg.slug }}
                  </dd>
                </div>

                <div class="rounded-xl border border-zinc-200 p-4">
                  <dt class="text-sm font-semibold text-zinc-900">
                    Created at
                  </dt>
                  <dd class="mt-1 text-sm text-zinc-700">
                    {{ currentOrg.createdAt }}
                  </dd>
                </div>
              </dl>

              <section class="mt-12" aria-labelledby="members-heading">
                <h2
                  id="members-heading"
                  class="text-lg font-semibold text-zinc-900"
                >
                  Members
                </h2>

                <div
                  class="mt-6 overflow-x-auto rounded-xl border border-zinc-200"
                >
                  <table class="min-w-full divide-y divide-zinc-200 text-left">
                    <thead class="bg-zinc-50">
                      <tr>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Member
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Role
                        </th>
                        <th
                          scope="col"
                          class="px-4 py-3 text-sm font-semibold text-zinc-900"
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100">
                      @for (member of members(); track member.uid) {
                        <tr>
                          <td class="px-4 py-3 font-medium text-zinc-900">
                            {{ member.uid }}
                          </td>
                          <td class="px-4 py-3">
                            <select
                              [id]="'role-' + member.uid"
                              name="role"
                              [attr.aria-label]="
                                'Change role for ' + member.uid
                              "
                              [disabled]="submitting()"
                              [value]="
                                pendingRoles()[member.uid] ?? member.role
                              "
                              (change)="onPendingRole(member.uid, $event)"
                              class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              @for (role of roles; track role) {
                                <option [value]="role">{{ role }}</option>
                              }
                            </select>
                          </td>
                          <td class="px-4 py-3">
                            <div class="flex flex-wrap gap-2">
                              <button
                                type="button"
                                [attr.aria-label]="
                                  'Change role for ' + member.uid
                                "
                                [disabled]="submitting()"
                                (click)="
                                  changeRole(
                                    member.uid,
                                    pendingRoles()[member.uid] ?? member.role
                                  )
                                "
                                class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Update role
                              </button>
                              <button
                                type="button"
                                [attr.aria-label]="'Remove ' + member.uid"
                                [disabled]="submitting()"
                                (click)="removeMember(member.uid)"
                                class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-red-700 shadow-sm ring-1 ring-inset ring-red-200 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td
                            colspan="3"
                            class="px-4 py-12 text-center text-sm text-zinc-500"
                          >
                            No members yet.
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>

              @if (submitError(); as message) {
                <div class="mt-6" role="alert">
                  <p
                    class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
                  >
                    {{ message }}
                  </p>
                </div>
              }

              <section class="mt-12" aria-labelledby="add-member-heading">
                <h2
                  id="add-member-heading"
                  class="text-lg font-semibold text-zinc-900"
                >
                  Add member
                </h2>

                <form
                  class="mt-6 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-3"
                >
                  <div>
                    <label
                      for="uid"
                      class="block text-sm font-medium leading-6 text-zinc-900"
                    >
                      Member uid
                    </label>
                    <input
                      id="uid"
                      name="uid"
                      type="text"
                      required
                      [disabled]="submitting()"
                      [value]="form.uid"
                      (input)="form.uid = $any($event.target).value"
                      class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label
                      for="role"
                      class="block text-sm font-medium leading-6 text-zinc-900"
                    >
                      Role
                    </label>
                    <select
                      id="role"
                      name="role"
                      required
                      [disabled]="submitting()"
                      [value]="form.role"
                      (change)="form.role = $any($event.target).value"
                      class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      @for (role of roles; track role) {
                        <option [value]="role">{{ role }}</option>
                      }
                    </select>
                  </div>

                  <div class="flex items-end sm:justify-end">
                    <button
                      type="button"
                      [disabled]="submitting()"
                      (click)="addMember()"
                      class="inline-flex h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      Add member
                    </button>
                  </div>
                </form>
              </section>
            }
          }
        }
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class AdminOrgDetailPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<PageState>({ status: 'loading' });
  readonly members = signal<MemberRow[]>([]);
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly pendingRoles = signal<Record<string, OrgRole>>({});

  readonly roles: OrgRole[] = ['admin', 'manager', 'check_in', 'volunteer'];

  readonly form: MemberForm = {
    uid: '',
    role: 'volunteer',
  };

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const orgId = this.route.snapshot.paramMap.get('orgId');

    if (orgId === null || orgId === '') {
      this.state.set({ status: 'not-found' });
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<OrgsDetailResponse>(adminOrgDetailEndpoint(orgId), {
          withCredentials: true,
        }),
      );

      this.setOrg(response.org);
    } catch (error) {
      const status = apiErrorStatus(error);

      if (status === 403) {
        this.state.set({ status: 'forbidden' });
        return;
      }

      if (status === 404) {
        this.state.set({ status: 'not-found' });
        return;
      }

      this.state.set({ status: 'error' });
    }
  }

  private setOrg(org: AdminOrg): void {
    this.state.set({ status: 'ready', org });
    this.members.set(toMemberRows(org));
  }

  org(): AdminOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  async addMember(): Promise<void> {
    const org = this.org();
    const uid = this.form.uid.trim();

    if (org === null || uid === '' || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<OrgMembersSetResponse>(
          adminOrgMembersEndpoint(org.orgId),
          { uid, role: this.form.role },
          { withCredentials: true },
        ),
      );

      this.setOrg(response.org);
      this.form.uid = '';
      this.form.role = 'volunteer';
    } catch (error) {
      this.setOrg(org);
      this.submitError.set(this.describeMemberError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  onPendingRole(uid: string, event: Event): void {
    const role = (event.target as HTMLSelectElement).value as OrgRole;

    this.pendingRoles.update((pending) => ({ ...pending, [uid]: role }));
  }

  async changeRole(uid: string, role: OrgRole): Promise<void> {
    const org = this.org();

    if (org === null || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.put<OrgMembersSetResponse>(
          adminOrgMembersEndpoint(org.orgId),
          { uid, role },
          { withCredentials: true },
        ),
      );

      this.setOrg(response.org);
    } catch (error) {
      this.setOrg(org);
      this.submitError.set(this.describeMemberError(error));
    } finally {
      this.clearPendingRole(uid);
      this.submitting.set(false);
    }
  }

  private clearPendingRole(uid: string): void {
    this.pendingRoles.update((pending) => {
      const next = { ...pending };
      delete next[uid];
      return next;
    });
  }

  async removeMember(uid: string): Promise<void> {
    const org = this.org();

    if (org === null || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.delete<OrgMembersRemoveResponse>(
          adminOrgMembersEndpoint(org.orgId),
          {
            body: { uid },
            withCredentials: true,
          },
        ),
      );

      this.setOrg(response.org);
    } catch (error) {
      this.setOrg(org);
      this.submitError.set(this.describeMemberError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private describeMemberError(error: unknown): string {
    const code = apiErrorCode(error);

    if (code === 'last-org-admin') {
      return 'An organizer must keep at least one admin. Add another admin before removing or demoting the last one.';
    }

    if (code === 'org-not-found') {
      return 'That organizer no longer exists.';
    }

    const status = apiErrorStatus(error);

    if (status === 400) {
      return 'That member change could not be made. Check the uid and role and try again.';
    }

    if (status === 403) {
      return 'You do not have permission to manage members.';
    }

    return 'Something went wrong while updating the member. Please try again.';
  }
}
