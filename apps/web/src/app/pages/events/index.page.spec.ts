import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicEvent } from '../../events/event-api';
import { eventsEndpoint } from '../../events/event-api';
import EventsPageComponent from './index.page';

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    eventId: 'evt_1',
    orgId: 'org_1',
    orgSlug: 'acme',
    title: 'Intro to Kubernetes',
    slug: 'intro-to-kubernetes',
    description: 'A hands-on afternoon.',
    startsAt: '2026-09-10T13:30:00.000Z',
    timezone: 'America/Toronto',
    location: 'MaRS Centre, Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 20,
    spotsRemaining: 12,
    soldOut: false,
    ...overrides,
  };
}

const emptyPage = { events: [], nextCursor: null };

/**
 * Answer the past-events request the page fires alongside the upcoming one.
 * Empty by default, which leaves the past section hidden.
 */
function flushPast(
  http: HttpTestingController,
  response: { events: PublicEvent[]; nextCursor: string | null } = emptyPage,
): void {
  http.expectOne(eventsEndpoint(undefined, 'past')).flush(response);
}

describe('EventsPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [EventsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EventsPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  it('renders every event as a card linking to its detail page', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http.expectOne(eventsEndpoint()).flush({
      events: [
        event(),
        event({
          eventId: 'evt_2',
          title: 'Rust for the web',
          slug: 'rust-for-the-web',
          location: undefined,
        }),
      ],
      nextCursor: null,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const cards = root.querySelectorAll('app-event-card');
    expect(cards.length).toBe(2);

    const links = root.querySelectorAll<HTMLAnchorElement>(
      'app-event-card h2 a',
    );
    expect(links[0]?.getAttribute('href')).toBe('/acme/intro-to-kubernetes');
    expect(links[1]?.getAttribute('href')).toBe('/acme/rust-for-the-web');
    expect(root.textContent).toContain('Intro to Kubernetes');
    expect(root.textContent).toContain('Rust for the web');
    http.verify();
  });

  it('sets the document title', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http.expectOne(eventsEndpoint()).flush({ events: [], nextCursor: null });
    await fixture.whenStable();

    expect(TestBed.inject(Title).getTitle()).toBe('Events · Upskills');
  });

  it('shows an empty state when no events are published', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http.expectOne(eventsEndpoint()).flush({ events: [], nextCursor: null });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No upcoming events');
    expect(root.textContent).not.toContain('Past events');
    expect(root.querySelector('app-event-card')).toBeNull();
    expect(root.querySelector('main button')).toBeNull();
    http.verify();
  });

  it('shows only a failure message when the list request fails', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http
      .expectOne(eventsEndpoint())
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Something went wrong');
    expect(root.textContent).not.toContain('Intro to Kubernetes');
    expect(root.querySelector('app-event-card')).toBeNull();
    http.verify();
  });

  it('renders loading on the server instead of an error, so the browser can recover', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EventsPageComponent);
    fixture.detectChanges();
    flushPast(http);

    http
      .expectOne(eventsEndpoint())
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Loading events');
    expect(root.textContent).not.toContain('Something went wrong');
    http.verify();
  });

  it('offers Try again from the error state and recovers', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http
      .expectOne(eventsEndpoint())
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('main button');
    expect(button?.textContent?.trim()).toBe('Try again');

    button?.click();

    http.expectOne(eventsEndpoint()).flush({
      events: [event()],
      nextCursor: null,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('app-event-card').length).toBe(1);
    expect(root.textContent).toContain('Intro to Kubernetes');
    http.verify();
  });

  it('offers Load more while a cursor remains and appends the next page', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http.expectOne(eventsEndpoint()).flush({
      events: [event()],
      nextCursor: 'cursor-2',
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('main button');
    expect(button?.textContent?.trim()).toBe('Load more');

    button?.click();

    const nextRequest = http.expectOne(eventsEndpoint('cursor-2'));
    expect(nextRequest.request.url).toBe('/api/v1/events?cursor=cursor-2');
    nextRequest.flush({
      events: [event({ eventId: 'evt_2', title: 'Rust for the web' })],
      nextCursor: null,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('app-event-card').length).toBe(2);
    expect(root.textContent).toContain('Rust for the web');
    expect(root.querySelector('main button')).toBeNull();
    http.verify();
  });

  it('hides Load more when the last page reports no cursor', async () => {
    const { fixture, http } = await setup();
    flushPast(http);

    http.expectOne(eventsEndpoint()).flush({
      events: [event()],
      nextCursor: null,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('main button'),
    ).toBeNull();
    http.verify();
  });
  describe('past events', () => {
    async function setupWithPast(past: {
      events: PublicEvent[];
      nextCursor: string | null;
    }) {
      await TestBed.configureTestingModule({
        imports: [EventsPageComponent],
        providers: [provideHttpClient(), provideHttpClientTesting()],
      }).compileComponents();

      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(EventsPageComponent);
      fixture.detectChanges();

      http.expectOne(eventsEndpoint()).flush({
        events: [event()],
        nextCursor: null,
      });
      flushPast(http, past);

      await fixture.whenStable();
      fixture.detectChanges();

      return { fixture, http, root: fixture.nativeElement as HTMLElement };
    }

    it('lists them below the upcoming events, marked as ended', async () => {
      const { http, root } = await setupWithPast({
        events: [
          event({
            eventId: 'evt_old',
            title: 'Last month meetup',
            slug: 'last-month-meetup',
            spotsRemaining: 3,
          }),
        ],
        nextCursor: null,
      });

      const section = root.querySelector(
        'section[aria-labelledby="past-events-heading"]',
      );
      expect(section?.textContent).toContain('Past events');
      expect(section?.textContent).toContain('Last month meetup');
      expect(section?.textContent).toContain('Ended');
      // A seat count on a past event reads as an invitation it cannot honour.
      expect(section?.textContent).not.toContain('spots left');
      expect(section?.querySelector('h2 a')?.getAttribute('href')).toBe(
        '/acme/last-month-meetup',
      );
      expect(root.querySelectorAll('app-event-card').length).toBe(2);
      http.verify();
    });

    it('pages the past list with its own cursor', async () => {
      const { fixture, http, root } = await setupWithPast({
        events: [event({ eventId: 'evt_old', title: 'Last month meetup' })],
        nextCursor: 'past-2',
      });

      const button = [
        ...root.querySelectorAll<HTMLButtonElement>('main button'),
      ].find((candidate) =>
        candidate.textContent?.includes('Load more past events'),
      );
      button?.click();

      const next = http.expectOne(eventsEndpoint('past-2', 'past'));
      expect(next.request.url).toBe('/api/v1/events?when=past&cursor=past-2');
      next.flush({
        events: [event({ eventId: 'evt_older', title: 'Spring workshop' })],
        nextCursor: null,
      });

      await fixture.whenStable();
      fixture.detectChanges();

      expect(root.textContent).toContain('Spring workshop');
      expect(root.textContent).not.toContain('Load more past events');
      http.verify();
    });

    it('stays hidden when the past list fails, without touching the main list', async () => {
      await TestBed.configureTestingModule({
        imports: [EventsPageComponent],
        providers: [provideHttpClient(), provideHttpClientTesting()],
      }).compileComponents();

      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(EventsPageComponent);
      fixture.detectChanges();

      http.expectOne(eventsEndpoint()).flush({
        events: [event()],
        nextCursor: null,
      });
      http
        .expectOne(eventsEndpoint(undefined, 'past'))
        .flush({}, { status: 500, statusText: 'Server Error' });

      await fixture.whenStable();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Intro to Kubernetes');
      expect(root.textContent).not.toContain('Past events');
      expect(root.textContent).not.toContain('Something went wrong');
      http.verify();
    });
  });
});
