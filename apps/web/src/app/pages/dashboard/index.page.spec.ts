import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  dashboardEventsEndpoint,
  dashboardOrgDetailEndpoint,
  dashboardOrgMembersEndpoint,
  meEndpoint,
  type MeGetResponse,
  type DashboardEvent,
} from '../../dashboard/dashboard-api';
import {
  dashboardOrg,
  meResponse,
  workshop,
} from '../../dashboard/testing/dashboard-fixtures';
import DashboardOverviewPageComponent from './index.page';

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
      .flush({ org: dashboardOrg() });

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
      .flush({ org: dashboardOrg() });

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

  it('names roster members by email and adds a member by email', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg() });
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

    const add = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add member',
    );
    if (add === undefined) {
      throw new Error('No add-member button');
    }

    add.click();
    fixture.detectChanges();

    const post = http.expectOne(dashboardOrgMembersEndpoint('org_1'));
    expect(post.request.method).toBe('POST');
    expect(post.request.withCredentials).toBe(true);
    expect(post.request.body).toEqual({
      email: 'grace@example.com',
      role: 'manager',
    });
    post.flush({ org: dashboardOrg() });

    await fixture.whenStable();

    // The page reloads itself from the API after a member write.
    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();
    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg() });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(root.textContent).toContain('Member added.');
    http.verify();
  });

  it('names an email that belongs to no account', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await fixture.whenStable();

    http
      .expectOne(dashboardOrgDetailEndpoint('org_1'))
      .flush({ org: dashboardOrg() });
    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#member-email');
    if (input === null) {
      throw new Error('No member email field');
    }

    input.value = 'nobody@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const add = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add member',
    );
    if (add === undefined) {
      throw new Error('No add-member button');
    }

    add.click();
    fixture.detectChanges();

    http
      .expectOne(dashboardOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'user-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(root.textContent).toContain('No account with that email address');
    http.verify();
  });
});
