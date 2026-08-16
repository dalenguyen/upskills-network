import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dashboardEventCancelEndpoint,
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('links to the new-event page from the page header', async () => {
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({ events: [] });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const newEvent = root.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/events/new"]',
    );
    expect(newEvent?.textContent?.trim()).toBe('New event');
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

  it('offers Cancel on draft and published rows but not cancelled rows', async () => {
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
        workshop({
          eventId: 'evt_3',
          title: 'Cancelled workshop',
          slug: 'cancelled-workshop',
          status: 'cancelled',
        }),
      ],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('button')?.textContent).toContain('Cancel');
    expect(rows[1].querySelector('button')?.textContent).toContain('Cancel');
    expect(rows[2].querySelector('button')).toBeNull();
    http.verify();
  });

  it('issues a DELETE with credentials and re-fetches the list when Cancel is confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    const deleteRequest = http.expectOne(dashboardEventCancelEndpoint('evt_1'));
    expect(deleteRequest.request.method).toBe('DELETE');
    expect(deleteRequest.request.withCredentials).toBe(true);
    deleteRequest.flush({
      event: workshop({ eventId: 'evt_1', status: 'cancelled' }),
      notification: { attempted: 3, sent: 3, failed: 0, failures: [] },
    });

    await Promise.resolve();

    const refetch = http.expectOne(dashboardEventsEndpoint('org_1'));
    expect(refetch.request.withCredentials).toBe(true);
    refetch.flush({
      events: [workshop({ eventId: 'evt_1', status: 'cancelled' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const row = root.querySelector<HTMLTableRowElement>('tbody tr');
    expect(row?.textContent).toContain('cancelled');
    expect(confirm).toHaveBeenCalledWith(
      'Cancel this event and notify confirmed guests?',
    );
    http.verify();
  });

  it('issues no request when Cancel is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    expect(confirm).toHaveBeenCalledWith(
      'Cancel this event and notify confirmed guests?',
    );
    http.expectNone(dashboardEventCancelEndpoint('evt_1'));
    http.verify();
  });

  it('shows how many guests were notified after a confirmed cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    const deleteRequest = http.expectOne(dashboardEventCancelEndpoint('evt_1'));
    deleteRequest.flush({
      event: workshop({ eventId: 'evt_1', status: 'cancelled' }),
      notification: { attempted: 3, sent: 3, failed: 0, failures: [] },
    });

    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'cancelled' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      'Event cancelled. 3 guests notified.',
    );
    http.verify();
  });

  it('reports partial failures from the notification fan-out', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    const deleteRequest = http.expectOne(dashboardEventCancelEndpoint('evt_1'));
    deleteRequest.flush({
      event: workshop({ eventId: 'evt_1', status: 'cancelled' }),
      notification: {
        attempted: 3,
        sent: 2,
        failed: 1,
        failures: [{ email: 'guest@example.com', reason: 'error', detail: '' }],
      },
    });

    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'cancelled' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      '2 of 3 guests notified; 1 could not be emailed.',
    );
    http.verify();
  });

  it('shows the zero-guests message when the cancel notifies nobody', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    const deleteRequest = http.expectOne(dashboardEventCancelEndpoint('evt_1'));
    deleteRequest.flush({
      event: workshop({ eventId: 'evt_1', status: 'cancelled' }),
      notification: { attempted: 0, sent: 0, failed: 0, failures: [] },
    });

    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'cancelled' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      'Event cancelled. 0 guests to notify.',
    );
    http.verify();
  });

  it('shows an inline error and leaves the list intact when the DELETE fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, http } = await setup();

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    http.expectOne(dashboardEventsEndpoint('org_1')).flush({
      events: [workshop({ eventId: 'evt_1', status: 'published' })],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('tbody tr button')?.click();

    const deleteRequest = http.expectOne(dashboardEventCancelEndpoint('evt_1'));
    deleteRequest.flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Something went wrong while cancelling the event',
    );
    const row = root.querySelector<HTMLTableRowElement>('tbody tr');
    expect(row?.textContent).toContain('published');
    expect(row?.textContent).not.toContain('cancelled');
    expect(root.querySelector('[role="status"]')).toBeNull();
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
