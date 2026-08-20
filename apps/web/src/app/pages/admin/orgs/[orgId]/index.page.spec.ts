import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  adminOrgDetailEndpoint,
  adminOrgInviteConfirmEndpoint,
  adminOrgInvitesEndpoint,
  adminOrgMembersEndpoint,
  type AdminOrg,
  type OrgInviteView,
  type OrgRole,
} from '../../../../admin/orgs-api';
import {
  dashboardEventCreateEndpoint,
  dashboardEventsEndpoint,
  type DashboardEvent,
} from '../../../../dashboard/dashboard-api';
import { workshop } from '../../../../dashboard/testing/dashboard-fixtures';
import AdminOrgDetailPageComponent from './index.page';

/** One organizer as the admin org routes serialize it. */
function adminOrg(overrides: Partial<AdminOrg> = {}): AdminOrg {
  return {
    orgId: 'org_1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-admin',
    members: {
      'uid-admin': {
        role: 'admin',
        addedAt: '2026-01-01T00:00:00.000Z',
        email: 'ada@example.com',
      },
      'uid-member': {
        role: 'manager',
        addedAt: '2026-01-02T00:00:00.000Z',
        email: 'grace@example.com',
      },
    },
    memberUids: ['uid-admin', 'uid-member'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One member write, then a roster update, as the member routes answer it. */
function withMember(
  org: AdminOrg,
  uid: string,
  role: OrgRole,
  email: string | null = null,
): AdminOrg {
  const addedAt = '2026-02-01T00:00:00.000Z';

  return {
    ...org,
    members: {
      ...org.members,
      [uid]: { role, addedAt, email: email ?? org.members[uid]?.email ?? null },
    },
    memberUids: Array.from(new Set([...org.memberUids, uid])),
  };
}

function withoutMember(org: AdminOrg, uid: string): AdminOrg {
  const members = { ...org.members };
  delete members[uid];

  return {
    ...org,
    members,
    memberUids: org.memberUids.filter((candidate) => candidate !== uid),
  };
}

/** One outstanding invitation, as the org detail route serializes it. */
function pendingInvite(overrides: Partial<OrgInviteView> = {}): OrgInviteView {
  return {
    inviteId: 'inv_1',
    email: 'hopper@example.com',
    role: 'manager',
    status: 'pending',
    invitedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('AdminOrgDetailPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(orgId: string | null = 'org_1') {
    await TestBed.configureTestingModule({
      imports: [AdminOrgDetailPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(orgId === null ? {} : { orgId }),
            },
          },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminOrgDetailPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  async function loadPage(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    http: HttpTestingController,
    org: AdminOrg = adminOrg(),
    invites: OrgInviteView[] = [],
    events: DashboardEvent[] = [],
  ): Promise<void> {
    const request = http.expectOne(adminOrgDetailEndpoint('org_1'));
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ org, invites });

    await fixture.whenStable();
    fixture.detectChanges();

    // The org detail route answers members and invites; the events section
    // reads the dashboard list route, which a platform admin may call for any
    // org.
    const eventsRequest = http.expectOne(dashboardEventsEndpoint('org_1'));
    expect(eventsRequest.request.withCredentials).toBe(true);
    eventsRequest.flush({ events });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    selector: string,
    value: string,
  ): void {
    const root = fixture.nativeElement as HTMLElement;
    const element = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector,
    );

    if (element === null) {
      throw new Error(`No form control matches ${selector}`);
    }

    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function buttonByText(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    text: string,
  ): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    const button = Array.from(buttons).find(
      (candidate) => candidate.textContent?.trim() === text,
    );

    if (button === undefined) {
      throw new Error(`No button with text ${text}`);
    }

    return button;
  }

  function buttonByLabel(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    label: string,
  ): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );

    if (button === null) {
      throw new Error(`No button with label ${label}`);
    }

    return button;
  }

  function memberRows(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
  ): NodeListOf<HTMLTableRowElement> {
    const root = fixture.nativeElement as HTMLElement;
    return root.querySelectorAll<HTMLTableRowElement>('tbody tr');
  }

  it('shows name, slug, createdAt, and the member roster by email and role', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills Toronto');
    expect(root.textContent).toContain('upskills-toronto');
    expect(root.textContent).toContain('2026-01-01T00:00:00.000Z');

    const rows = memberRows(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('ada@example.com');
    expect(rows[0].textContent).toContain('admin');
    expect(rows[1].textContent).toContain('grace@example.com');
    expect(rows[1].textContent).toContain('manager');
    expect(root.textContent).not.toContain('uid-admin');
    http.verify();
  });

  it('falls back to the uid for a member whose account is gone', async () => {
    const { fixture, http } = await setup();
    await loadPage(
      fixture,
      http,
      withMember(adminOrg(), 'uid-orphan', 'volunteer'),
    );

    const rows = memberRows(fixture);
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('uid-orphan');
    http.verify();
  });

  it('invites with a POST and shows the invitee as pending', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#email', 'new@example.com');
    setValue(fixture, '#role', 'volunteer');

    buttonByText(fixture, 'Send invitation').click();
    fixture.detectChanges();

    const addRequest = http.expectOne(adminOrgInvitesEndpoint('org_1'));
    expect(addRequest.request.method).toBe('POST');
    expect(addRequest.request.withCredentials).toBe(true);
    expect(addRequest.request.body).toEqual({
      email: 'new@example.com',
      role: 'volunteer',
    });
    addRequest.flush({
      org: adminOrg(),
      invites: [pendingInvite({ email: 'new@example.com', role: 'volunteer' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = memberRows(fixture);
    // Two members, then the invitation — nobody was added to the roster.
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('new@example.com');
    expect(rows[2].textContent).toContain('Pending');
    expect(root.querySelector<HTMLInputElement>('#email')?.value).toBe('');
    expect(root.querySelector<HTMLSelectElement>('#role')?.value).toBe(
      'volunteer',
    );
    http.verify();
  });

  it('changes a member role with a PUT and updates the roster from the response', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#role-uid-member', 'volunteer');
    buttonByLabel(fixture, 'Change role for grace@example.com').click();
    fixture.detectChanges();

    const changeRequest = http.expectOne(adminOrgMembersEndpoint('org_1'));
    expect(changeRequest.request.method).toBe('PUT');
    expect(changeRequest.request.withCredentials).toBe(true);
    expect(changeRequest.request.body).toEqual({
      uid: 'uid-member',
      role: 'volunteer',
    });
    changeRequest.flush({
      org: withMember(adminOrg(), 'uid-member', 'volunteer'),
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector<HTMLSelectElement>('#role-uid-member')?.value,
    ).toBe('volunteer');
    expect(memberRows(fixture)[1].textContent).toContain('volunteer');
    http.verify();
  });

  it('removes a member with a DELETE carrying the uid in the body', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    buttonByLabel(fixture, 'Remove grace@example.com').click();
    fixture.detectChanges();

    const removeRequest = http.expectOne(adminOrgMembersEndpoint('org_1'));
    expect(removeRequest.request.method).toBe('DELETE');
    expect(removeRequest.request.withCredentials).toBe(true);
    expect(removeRequest.request.body).toEqual({ uid: 'uid-member' });
    removeRequest.flush({
      org: withoutMember(adminOrg(), 'uid-member'),
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(memberRows(fixture)).toHaveLength(1);
    expect(root.textContent).toContain('ada@example.com');
    expect(root.textContent).not.toContain('grace@example.com');
    http.verify();
  });

  it('names the last-admin conflict when demoting the last admin', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, withoutMember(adminOrg(), 'uid-member'));

    setValue(fixture, '#role-uid-admin', 'manager');
    buttonByLabel(fixture, 'Change role for ada@example.com').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'last-org-admin' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('must keep at least one admin');
    expect(root.textContent).not.toContain(
      'Something went wrong while updating the member',
    );
    expect(
      root.querySelector<HTMLSelectElement>('#role-uid-admin')?.value,
    ).toBe('admin');
    http.verify();
  });

  it('names the last-admin conflict when removing the last admin', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, withoutMember(adminOrg(), 'uid-member'));

    buttonByLabel(fixture, 'Remove ada@example.com').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'last-org-admin' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('must keep at least one admin');
    expect(text).not.toContain(
      'Something went wrong while updating the member',
    );
    http.verify();
  });

  it('refuses to invite somebody already on the roster', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#email', 'ada@example.com');
    buttonByText(fixture, 'Send invitation').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgInvitesEndpoint('org_1'))
      .flush(
        { data: { error: 'already-a-member' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'already on this organizer',
    );
    http.verify();
  });

  it('revokes an invitation with a DELETE carrying the inviteId', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [pendingInvite()]);

    buttonByLabel(fixture, 'Revoke invitation for hopper@example.com').click();
    fixture.detectChanges();

    const request = http.expectOne(adminOrgInvitesEndpoint('org_1'));
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ inviteId: 'inv_1' });
    request.flush({ org: adminOrg(), invites: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Invitation revoked.');
    expect(root.querySelector('tbody')?.textContent).not.toContain(
      'hopper@example.com',
    );
    http.verify();
  });

  it('marks an invitation accepted on the invitee behalf', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [pendingInvite()]);

    buttonByLabel(fixture, 'Mark hopper@example.com as accepted').click();
    fixture.detectChanges();

    const request = http.expectOne(adminOrgInviteConfirmEndpoint('org_1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ inviteId: 'inv_1' });
    request.flush({
      org: withMember(
        adminOrg(),
        'uid-hopper',
        'manager',
        'hopper@example.com',
      ),
      invites: [],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Member added.');
    expect(root.querySelector('tbody')?.textContent).toContain('Active');
    http.verify();
  });

  it('explains an invitee who has never signed in', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [pendingInvite()]);

    buttonByLabel(fixture, 'Mark hopper@example.com as accepted').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgInviteConfirmEndpoint('org_1'))
      .flush(
        { data: { error: 'invitee-has-no-account' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'have not signed in to Upskills yet',
    );
    http.verify();
  });

  it('offers no mark-accepted on an expired invitation, only a resend', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [
      pendingInvite({ status: 'expired' }),
    ]);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Expired');
    expect(
      root.querySelector('button[aria-label^="Mark hopper@example.com"]'),
    ).toBeNull();
    expect(
      root.querySelector(
        'button[aria-label="Resend invitation to hopper@example.com"]',
      ),
    ).not.toBeNull();
    http.verify();
  });

  it('shows a permission message when the detail request answers 403', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
      .flush(
        { data: { error: 'forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      "You don't have permission to view this page",
    );
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('shows a not-found message when the detail request answers 404', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
      .flush(
        { data: { error: 'org-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("couldn't find that organizer");
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('shows only a failure message when the detail request fails', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Something went wrong');
    expect(root.textContent).not.toContain('Upskills Toronto');
    expect(root.querySelector('tbody')).toBeNull();
    http.verify();
  });

  it('shows not-found without calling the API when the route has no orgId', async () => {
    const { fixture, http } = await setup(null);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that organizer",
    );
    http.verify();
  });

  it('clears the success notice when a later write fails', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [pendingInvite()]);

    buttonByLabel(fixture, 'Revoke invitation for hopper@example.com').click();
    fixture.detectChanges();
    http
      .expectOne(adminOrgInvitesEndpoint('org_1'))
      .flush({ org: adminOrg(), invites: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Invitation revoked.');

    // A failure right after must not render beside the stale green notice.
    setValue(fixture, '#role-uid-member', 'volunteer');
    buttonByLabel(fixture, 'Change role for grace@example.com').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'last-org-admin' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).toContain('must keep at least one admin');
    expect(root.textContent).not.toContain('Invitation revoked.');
    http.verify();
  });
  it('lists the organizer events, all statuses, with the platform admin extras', async () => {
    const { fixture, http } = await setup();
    await loadPage(
      fixture,
      http,
      adminOrg(),
      [],
      [
        workshop({ title: 'Intro to Kubernetes', status: 'draft' }),
        workshop({
          eventId: 'evt_2',
          title: 'Rust for the web',
          slug: 'rust-for-the-web',
          status: 'cancelled',
        }),
      ],
    );

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Intro to Kubernetes');
    expect(root.textContent).toContain('Rust for the web');
    // Delete is the admin-only extra, and only a draft may be deleted.
    expect(
      Array.from(root.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Delete',
      ),
    ).toHaveLength(1);
    http.verify();
  });

  it('creates an event inline and re-reads the list from the server', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    buttonByText(fixture, 'New event').click();
    fixture.detectChanges();
    // `ngModel` inside a `<form>` registers its control on a microtask, and
    // writes nothing back to the model until it has. Let that settle before
    // typing, or every field posts empty.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();

    setValue(fixture, '#title', 'Rust for the web');
    setValue(fixture, '#description', 'A hands-on afternoon.');
    setValue(fixture, '#startsAt', '2026-09-01T18:00');
    setValue(fixture, '#price', '0');
    setValue(fixture, '#maxGuests', '20');
    await fixture.whenStable();
    fixture.detectChanges();

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    const create = http.expectOne(dashboardEventCreateEndpoint('org_1'));
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toMatchObject({
      title: 'Rust for the web',
      // Derived from the title, the same rule the dashboard form follows.
      slug: 'rust-for-the-web',
      status: 'published',
    });
    create.flush({ event: workshop({ slug: 'rust-for-the-web' }) });

    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();

    http
      .expectOne(dashboardEventsEndpoint('org_1'))
      .flush({ events: [workshop({ title: 'Rust for the web' })] });

    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Rust for the web',
    );
    http.verify();
  });

  it('opens the inline edit form pre-filled from the row', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, adminOrg(), [], [workshop()]);

    buttonByText(fixture, 'Edit').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Edit event');
    expect(root.querySelector<HTMLInputElement>('#title')?.value).toBe(
      'Intro to Kubernetes',
    );
    expect(root.querySelector<HTMLInputElement>('#slug')?.value).toBe(
      'intro-to-kubernetes',
    );
    http.verify();
  });
});
