import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  dashboardEventsEndpoint,
  meEndpoint,
  type MeGetResponse,
  type DashboardEvent,
} from '../../../dashboard/dashboard-api';
import {
  meResponse,
  workshop,
} from '../../../dashboard/testing/dashboard-fixtures';
import DashboardEventsPageComponent from './index.page';

describe('DashboardEventsPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [DashboardEventsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DashboardEventsPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  it('renders the no-orgs empty state and does not call the events route', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush({ ...meResponse, orgs: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'not a member of an organizer yet',
    );
    http.verify();
  });

  it('lists title, status, start date, and capacity, each linking to the public page', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    const eventsRequest = http.expectOne(dashboardEventsEndpoint('org_1'));
    expect(eventsRequest.request.withCredentials).toBe(true);
    eventsRequest.flush({
      events: [
        workshop({ eventId: 'evt_1', status: 'published' }),
        workshop({
          eventId: 'evt_2',
          title: 'Rust for the web',
          slug: 'rust-for-the-web',
          status: 'draft',
          maxGuests: 0,
        }),
      ],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows.length).toBe(2);

    const firstRow = rows[0];
    expect(firstRow.textContent).toContain('Intro to Kubernetes');
    expect(firstRow.textContent).toContain('published');
    expect(firstRow.textContent).toContain('20 guests');
    expect(firstRow.querySelector('a')?.getAttribute('href')).toBe(
      '/events/intro-to-kubernetes',
    );

    const secondRow = rows[1];
    expect(secondRow.textContent).toContain('Rust for the web');
    expect(secondRow.textContent).toContain('draft');
    expect(secondRow.textContent).toContain('Unlimited');
    expect(secondRow.querySelector('a')?.getAttribute('href')).toBe(
      '/events/rust-for-the-web',
    );
    http.verify();
  });

  it('links every row to its edit page without replacing the public link', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [
        workshop({ eventId: 'evt_1', status: 'published' }),
        workshop({
          eventId: 'evt_2',
          title: 'Rust for the web',
          slug: 'rust-for-the-web',
          status: 'draft',
        }),
      ],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows.length).toBe(2);

    const firstLinks = rows[0].querySelectorAll<HTMLAnchorElement>('a');
    expect(firstLinks[0]?.getAttribute('href')).toBe(
      '/events/intro-to-kubernetes',
    );
    expect(firstLinks[1]?.getAttribute('href')).toBe(
      '/dashboard/events/evt_1/edit',
    );

    const secondLinks = rows[1].querySelectorAll<HTMLAnchorElement>('a');
    expect(secondLinks[0]?.getAttribute('href')).toBe(
      '/events/rust-for-the-web',
    );
    expect(secondLinks[1]?.getAttribute('href')).toBe(
      '/dashboard/events/evt_2/edit',
    );
    http.verify();
  });

  it('does not offer an Edit link on a cancelled row', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'cancelled' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector<HTMLTableRowElement>('tbody tr');
    const links = row?.querySelectorAll<HTMLAnchorElement>('a') ?? [];
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute('href')).toBe('/events/intro-to-kubernetes');
    expect(row?.textContent).not.toContain('Edit');
    http.verify();
  });

  it('renders a zero-events empty state distinct from the no-orgs state', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No events yet');
    expect(text).not.toContain('not a member of an organizer yet');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('tbody'),
    ).toBeNull();
  });

  it('shows only a failure message when the events request fails', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http
      .expectOne(dashboardEventsEndpoint('org_1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Something went wrong');
    expect(text).not.toContain('Intro to Kubernetes');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('tbody'),
    ).toBeNull();
  });
});
