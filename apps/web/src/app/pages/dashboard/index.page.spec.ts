import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dashboardEventsEndpoint,
  dashboardOrgDetailEndpoint,
  dashboardOrgInviteConfirmEndpoint,
  dashboardOrgInvitesEndpoint,
  meEndpoint,
  type MeGetResponse,
  type DashboardEvent,
  type OrgInviteView,
} from '../../dashboard/dashboard-api';
import {
  dashboardOrg,
  meResponse,
  workshop,
} from '../../dashboard/testing/dashboard-fixtures';
import DashboardOverviewPageComponent from './index.page';

/** One outstanding invitation, as the org detail route serializes it. */
function pendingInvite(overrides: Partial<OrgInviteView> = {}): OrgInviteView {
  return {
    inviteId: 'inv_1',
    email: 'grace@example.com',
    role: 'manager',
    status: 'pending',
    invitedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
    ...overrides,
  };
}

function sendInvitationButton(root: HTMLElement): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === 'Send invitation',
  );

  if (button === undefined) {
    throw new Error('No send-invitation button');
  }

  return button;
}

/**
 * Load the page with one pending invitation on the roster, and hand back the
 * rendered root. Every invite-management test starts from this state.
 */
async function loadWithInvite(
  fixture: ComponentFixture<DashboardOverviewPageComponent>,
  http: HttpTestingController,
): Promise<HTMLElement> {
  http.expectOne(meEndpoint()).flush(meResponse);
  await fixture.whenStable();

  http
    .expectOne(dashboardOrgDetailEndpoint('org_1'))
    .flush({ org: dashboardOrg(), invites: [pendingInvite()] });
  http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();

  return fixture.nativeElement as HTMLElement;
}

/** Answer the three requests the page re-issues after every invite write. */
async function reload(
  fixture: ComponentFixture<DashboardOverviewPageComponent>,
  http: HttpTestingController,
  invites: OrgInviteView[],
): Promise<void> {
  await fixture.whenStable();

  http.expectOne(meEndpoint()).flush(meResponse);
  await fixture.whenStable();

  http
    .expectOne(dashboardOrgDetailEndpoint('org_1'))
    .flush({ org: dashboardOrg(), invites });
  http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (button === null) {
    throw new Error(`No button with label ${label}`);
  }

  return button;
}

describe('DashboardOverviewPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [DashboardOverviewPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DashboardOverviewPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  it('renders the no-orgs empty state and does not call the events route', async () => {
    const { fixture, http } = await setup();

    const meRequest = http.expectOne(meEndpoint());
    expect(meRequest.request.method).toBe('GET');
    expect(meRequest.request.withCredentials).toBe(true);
    meRequest.flush({ ...meResponse, orgs: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'not a member of an organizer yet',
    );
    http.verify();
  });

  it('shows the org name, caller role, and draft/published/cancelled counts', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [] });

    const eventsRequest = http.expectOne(dashboardEventsEndpoint('org_1'));
    expect(eventsRequest.request.withCredentials).toBe(true);
    eventsRequest.flush({
      events: [
        workshop({ eventId: 'evt_1', status: 'draft' }),
        workshop({
          eventId: 'evt_2',
          slug: 'sold-out-rust',
          status: 'published',
        }),
        workshop({
          eventId: 'evt_3',
          slug: 'cancelled-python',
          status: 'cancelled',
        }),
        workshop({ eventId: 'evt_4', slug: 'second-draft', status: 'draft' }),
      ],
    });

    // `Promise.all` in `load()` resolves a microtask hop after `whenStable`
    // settles in this zoneless setup, so wait a macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Upskills Toronto');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('admin');

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('#dashboard-draft-count')?.textContent?.trim(),
    ).toBe('2');
    expect(
      root.querySelector('#dashboard-published-count')?.textContent?.trim(),
    ).toBe('1');
    expect(
      root.querySelector('#dashboard-cancelled-count')?.textContent?.trim(),
    ).toBe('1');
    http.verify();
  });

  it('shows only a failure message when the events request fails', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [] });

    http
      .expectOne(dashboardEventsEndpoint('org_1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Something went wrong');
    expect(text).not.toContain('Upskills Toronto');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'a[href="/dashboard/events"]',
      ),
    ).toBeNull();
  });

  it('holds the loading state when the session is gone, rather than flashing an error', async () => {
    // Every server render reaches this: SSR carries no session cookie, so
    // `me.get` answers 401 `invalid-session` and the interceptor starts a
    // redirect to /auth/login without waiting for it. Painting the error
    // branch here is what put "Something went wrong" in the delivered HTML,
    // one frame before the real content replaced it.
    const { fixture, http } = await setup();

    http
      .expectOne(meEndpoint())
      .flush(
        { error: 'invalid-session', reason: 'missing' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Something went wrong');
    expect(text).toContain('Loading dashboard');
  });

  it('names roster members by email and invites by email', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [] });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const roster = root.querySelector('tbody');
    expect(roster?.textContent).toContain('ada@example.com');
    // The uid is the key the write travels by, not something the roster shows.
    expect(roster?.textContent).not.toContain('user_1');

    const input = root.querySelector<HTMLInputElement>('#member-email');
    if (input === null) {
      throw new Error('No member email field');
    }

    input.value = 'grace@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const add = sendInvitationButton(root);

    add.click();
    fixture.detectChanges();

    const post = http.expectOne(dashboardOrgInvitesEndpoint('org_1'));
    expect(post.request.method).toBe('POST');
    expect(post.request.withCredentials).toBe(true);
    expect(post.request.body).toEqual({
      email: 'grace@example.com',
      role: 'manager',
    });
    post.flush({ org: dashboardOrg(), invites: [pendingInvite()] });

    await fixture.whenStable();

    // The page reloads itself from the API after an invite write.
    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();
    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [pendingInvite()] });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(root.textContent).toContain('Invitation sent');

    // Nobody became a member: the invitee sits on the roster as pending.
    const rosterAfter = root.querySelector('tbody');
    expect(rosterAfter?.textContent).toContain('grace@example.com');
    expect(rosterAfter?.textContent).toContain('Pending');
    http.verify();
  });

  it('refuses to invite somebody already on the roster', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [] });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#member-email');
    if (input === null) {
      throw new Error('No member email field');
    }

    input.value = 'ada@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const add = sendInvitationButton(root);

    add.click();
    fixture.detectChanges();

    http
      .expectOne(dashboardOrgInvitesEndpoint('org_1'))
      .flush(
        { data: { error: 'already-a-member' } },
        { status: 409, statusText: 'Conflict' },
      );

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(root.textContent).toContain('already on this organizer');
    http.verify();
  });

  it('revokes a pending invitation', async () => {
    const { fixture, http } = await setup();
    const root = await loadWithInvite(fixture, http);

    const revoke = buttonByLabel(
      root,
      'Revoke invitation for grace@example.com',
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    revoke.click();
    fixture.detectChanges();

    const request = http.expectOne(dashboardOrgInvitesEndpoint('org_1'));
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ inviteId: 'inv_1' });
    request.flush({ org: dashboardOrg(), invites: [] });

    await reload(fixture, http, []);

    expect(root.textContent).toContain('Invitation revoked.');
    expect(root.querySelector('tbody')?.textContent).not.toContain(
      'grace@example.com',
    );
    http.verify();
  });

  it('resends a pending invitation as a fresh invite for the same address', async () => {
    const { fixture, http } = await setup();
    const root = await loadWithInvite(fixture, http);

    buttonByLabel(root, 'Resend invitation to grace@example.com').click();
    fixture.detectChanges();

    const request = http.expectOne(dashboardOrgInvitesEndpoint('org_1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'grace@example.com',
      role: 'manager',
    });
    request.flush({ org: dashboardOrg(), invites: [pendingInvite()] });

    await reload(fixture, http, [pendingInvite()]);

    expect(root.textContent).toContain('Invitation sent again.');
    http.verify();
  });

  it('marks a pending invitation accepted on the invitee behalf', async () => {
    const { fixture, http } = await setup();
    const root = await loadWithInvite(fixture, http);

    buttonByLabel(root, 'Mark grace@example.com as accepted').click();
    fixture.detectChanges();

    const request = http.expectOne(dashboardOrgInviteConfirmEndpoint('org_1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ inviteId: 'inv_1' });
    request.flush({ org: dashboardOrg(), invites: [] });

    await reload(fixture, http, []);

    expect(root.textContent).toContain('Member added.');
    http.verify();
  });

  it('explains an invitee who has never signed in', async () => {
    const { fixture, http } = await setup();
    const root = await loadWithInvite(fixture, http);

    buttonByLabel(root, 'Mark grace@example.com as accepted').click();
    fixture.detectChanges();

    http
      .expectOne(dashboardOrgInviteConfirmEndpoint('org_1'))
      .flush(
        { data: { error: 'invitee-has-no-account' } },
        { status: 409, statusText: 'Conflict' },
      );

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(root.textContent).toContain('have not signed in to Upskills yet');
    http.verify();
  });

  it('offers no resend or revoke to a non-admin member', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush({
      ...meResponse,
      orgs: [{ ...meResponse.orgs[0], role: 'volunteer' }],
    });
    await fixture.whenStable();
    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg(), invites: [pendingInvite()] });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('button[aria-label^="Revoke invitation"]'),
    ).toBeNull();
    expect(root.querySelector('#member-email')).toBeNull();
    http.verify();
  });
});
