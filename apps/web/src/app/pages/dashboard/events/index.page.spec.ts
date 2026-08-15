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
  type WorkshopEvent,
} from '../../../dashboard/dashboard-api';
import DashboardEventsPageComponent from './index.page';

const meResponse: MeGetResponse = {
  user: {
    uid: 'user_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  orgs: [
    {
      orgId: 'org_1',
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      role: 'manager',
    },
  ],
};

function timestamp(iso: string) {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

function workshop(overrides: Partial<WorkshopEvent> = {}): WorkshopEvent {
  return {
    eventId: 'evt_1',
    orgId: 'org_1',
    title: 'Intro to Kubernetes',
    slug: 'intro-to-kubernetes',
    description: 'A hands-on afternoon.',
    startsAt: timestamp('2026-09-10T13:30:00.000Z'),
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 20,
    confirmedCount: 5,
    heldCount: 0,
    pendingCount: 0,
    status: 'draft',
    createdAt: timestamp('2026-01-01T00:00:00.000Z'),
    updatedAt: timestamp('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

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

    const eventsRequest = http.expectOne(
      dashboardEventsEndpoint('org_1'),
    );
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

  it('renders a zero-events empty state distinct from the no-orgs state', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http
      .expectOne(dashboardEventsEndpoint('org_1'))
      .flush({ events: [] });

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
