import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';

import {
  adminOrgDetailEndpoint,
  adminOrgInviteConfirmEndpoint,
  adminOrgInvitesEndpoint,
  adminOrgMembersEndpoint,
  type AdminOrg,
  type AdminOrgInvitesResponse,
  type OrgInviteView,
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
 * separate roster request: `org.members` is already keyed by uid, and each entry
 * carries the member's email so the roster can name people rather than ids. Member writes
 * post back to `/api/v1/admin/orgs/:orgId/members` and each response carries
 * the updated org, which replaces the local state without a second fetch.
 */

interface MemberForm {
  email: string;
  role: OrgRole;
}

interface MemberRow {
  uid: string;
  role: OrgRole;
  /** What the row is labelled by: the member's email, or their uid when the
   * account behind the membership is gone. */
  label: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; org: AdminOrg; invites: OrgInviteView[] };

/**
 * Roster rows sorted by the label they render, so the list reads alphabetically
 * by email. The row key stays the uid — that is what member writes are keyed by
 * and what keeps the per-row role selects bound to the right member.
 */
function toMemberRows(org: AdminOrg): MemberRow[] {
  return Object.entries(org.members)
    .map(([uid, membership]): MemberRow => ({
      uid,
      role: membership.role,
      label: membership.email ?? uid,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
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
                          Status
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
                            {{ member.label }}
                          </td>
                          <td class="px-4 py-3">
                            <select
                              [id]="'role-' + member.uid"
                              name="role"
                              [attr.aria-label]="
                                'Change role for ' + member.label
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
                            <span
                              class="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200"
                            >
                              Active
                            </span>
                          </td>
                          <td class="px-4 py-3">
                            <div class="flex flex-wrap gap-2">
                              <button
                                type="button"
                                [attr.aria-label]="
                                  'Change role for ' + member.label
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
                                [attr.aria-label]="'Remove ' + member.label"
                                [disabled]="submitting()"
                                (click)="removeMember(member.uid)"
                                class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-red-700 shadow-sm ring-1 ring-inset ring-red-200 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      }

                      @for (invite of invites(); track invite.inviteId) {
                        <tr class="bg-amber-50/40">
                          <td class="px-4 py-3 font-medium text-zinc-900">
                            {{ invite.email }}
                          </td>
                          <td class="px-4 py-3 capitalize text-zinc-700">
                            {{ invite.role }}
                          </td>
                          <td class="px-4 py-3">
                            @if (invite.status === 'expired') {
                              <span
                                class="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200"
                              >
                                Expired
                              </span>
                            } @else {
                              <span
                                class="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                              >
                                Pending
                              </span>
                            }
                          </td>
                          <td class="px-4 py-3">
                            <div class="flex flex-wrap gap-2">
                              <button
                                type="button"
                                [attr.aria-label]="
                                  'Resend invitation to ' + invite.email
                                "
                                [disabled]="submitting()"
                                (click)="resendInvite(invite)"
                                class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Resend
                              </button>
                              @if (invite.status === 'pending') {
                                <button
                                  type="button"
                                  [attr.aria-label]="
                                    'Mark ' + invite.email + ' as accepted'
                                  "
                                  [disabled]="submitting()"
                                  (click)="confirmInvite(invite)"
                                  class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-green-700 shadow-sm ring-1 ring-inset ring-green-200 transition hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Mark accepted
                                </button>
                              }
                              <button
                                type="button"
                                [attr.aria-label]="
                                  'Revoke invitation for ' + invite.email
                                "
                                [disabled]="submitting()"
                                (click)="revokeInvite(invite)"
                                class="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-red-700 shadow-sm ring-1 ring-inset ring-red-200 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Revoke
                              </button>
                            </div>
                          </td>
                        </tr>
                      }

                      @if (members().length === 0 && invites().length === 0) {
                        <tr>
                          <td
                            colspan="4"
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

              @if (submitNotice(); as message) {
                <div class="mt-6" role="status">
                  <p
                    class="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-200"
                  >
                    {{ message }}
                  </p>
                </div>
              }

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
                  Invite member
                </h2>

                <form
                  class="mt-6 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-3"
                >
                  <div>
                    <label
                      for="email"
                      class="block text-sm font-medium leading-6 text-zinc-900"
                    >
                      Invite by email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      placeholder="person@example.com"
                      [disabled]="submitting()"
                      [value]="form.email"
                      (input)="form.email = $any($event.target).value"
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
                      Send invitation
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
  readonly submitNotice = signal<string | null>(null);
  readonly pendingRoles = signal<Record<string, OrgRole>>({});

  readonly roles: OrgRole[] = ['admin', 'manager', 'check_in', 'volunteer'];

  readonly form: MemberForm = {
    email: '',
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

      this.setOrg(response.org, response.invites);
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

  private setOrg(org: AdminOrg, invites: OrgInviteView[]): void {
    this.state.set({ status: 'ready', org, invites });
    this.members.set(toMemberRows(org));
  }

  org(): AdminOrg | null {
    const state = this.state();
    return state.status === 'ready' ? state.org : null;
  }

  invites(): OrgInviteView[] {
    const state = this.state();
    return state.status === 'ready' ? state.invites : [];
  }

  async addMember(): Promise<void> {
    const org = this.org();
    const email = this.form.email.trim();

    if (org === null || email === '' || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<AdminOrgInvitesResponse>(
          adminOrgInvitesEndpoint(org.orgId),
          { email, role: this.form.role },
          { withCredentials: true },
        ),
      );

      this.setOrg(response.org, response.invites);
      this.form.email = '';
      this.form.role = 'volunteer';
      this.submitNotice.set(
        'Invitation sent. They stay pending until they accept.',
      );
    } catch (error) {
      this.submitError.set(this.describeMemberError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Issue a fresh invitation for the same address, invalidating the old link. */
  async resendInvite(invite: OrgInviteView): Promise<void> {
    await this.inviteWrite(
      (orgId) =>
        this.http.post<AdminOrgInvitesResponse>(
          adminOrgInvitesEndpoint(orgId),
          { email: invite.email, role: invite.role },
          { withCredentials: true },
        ),
      'Invitation sent again.',
    );
  }

  /** Withdraw an invitation. The emailed link stops working immediately. */
  async revokeInvite(invite: OrgInviteView): Promise<void> {
    await this.inviteWrite(
      (orgId) =>
        this.http.delete<AdminOrgInvitesResponse>(
          adminOrgInvitesEndpoint(orgId),
          {
            body: { inviteId: invite.inviteId },
            withCredentials: true,
          },
        ),
      'Invitation revoked.',
    );
  }

  /**
   * Accept on the invitee's behalf. Needs an account to key the membership by,
   * so an address that has never signed in answers `invitee-has-no-account` and
   * the invitation stays pending.
   */
  async confirmInvite(invite: OrgInviteView): Promise<void> {
    await this.inviteWrite(
      (orgId) =>
        this.http.post<AdminOrgInvitesResponse>(
          adminOrgInviteConfirmEndpoint(orgId),
          { inviteId: invite.inviteId },
          { withCredentials: true },
        ),
      'Member added.',
    );
  }

  /** The shared shape of every invite write: submit, then replace local state. */
  private async inviteWrite(
    request: (orgId: string) => Observable<AdminOrgInvitesResponse>,
    notice: string,
  ): Promise<void> {
    const org = this.org();

    if (org === null || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    this.submitNotice.set(null);

    try {
      const response = await firstValueFrom(request(org.orgId));

      this.setOrg(response.org, response.invites);
      this.submitNotice.set(notice);
    } catch (error) {
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

      this.setOrg(response.org, this.invites());
    } catch (error) {
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

      this.setOrg(response.org, this.invites());
    } catch (error) {
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

    if (code === 'ambiguous-email') {
      return 'More than one account uses that email address. Ask an operator to sort it out before adding them.';
    }

    if (code === 'already-a-member') {
      return 'That person is already on this organizer. Change their role from the roster instead.';
    }

    if (code === 'invitee-has-no-account') {
      return 'They have not signed in to Upskills yet, so there is no account to add. Their invitation link still works.';
    }

    if (code === 'invite-not-pending') {
      return 'That invitation is no longer outstanding. Refresh to see the current roster.';
    }

    if (code === 'invite-not-found') {
      return 'That invitation no longer exists. Refresh to see the current roster.';
    }

    if (code === 'user-not-found') {
      return 'No account with that email address. They need to sign in once before they can be added.';
    }

    const status = apiErrorStatus(error);

    if (status === 400) {
      return 'That member change could not be made. Check the email address and role and try again.';
    }

    if (status === 403) {
      return 'You do not have permission to manage members.';
    }

    return 'Something went wrong while updating the member. Please try again.';
  }
}
