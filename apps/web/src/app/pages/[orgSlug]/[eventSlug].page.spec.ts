import { DOCUMENT } from '@angular/common';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, type AuthUser } from '../../auth/auth-service';
import { CLOCK } from '../../events/clock';
import type { PublicEvent } from '../../events/event-api';
import { eventDetailEndpoint } from '../../events/event-api';
import EventPageComponent from './[eventSlug].page';

const event: PublicEvent = {
  eventId: 'evt_1',
  orgId: 'org_1',
  orgSlug: 'acme',
  title: 'Intro to Kubernetes',
  slug: 'intro-to-kubernetes',
  description: 'A hands-on afternoon.',
  startsAt: '2026-09-10T13:30:00.000Z',
  timezone: 'America/Toronto',
  price: 0,
  currency: 'cad',
  maxGuests: 20,
  spotsRemaining: 5,
  soldOut: false,
};

function authServiceStub() {
  return {
    user: signal<AuthUser | null>(null),
    ready: signal(true),
    logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('EventPageComponent', () => {
  let http: HttpTestingController;

  /** A week before the fixture event, so it is upcoming unless a spec says otherwise. */
  const beforeTheEvent = new Date('2026-09-03T12:00:00.000Z');

  async function setup(
    eventSlug: string | null,
    orgSlug: string | null = 'acme',
    now: Date = beforeTheEvent,
  ) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({
                ...(orgSlug === null ? {} : { orgSlug }),
                ...(eventSlug === null ? {} : { eventSlug }),
              }),
            },
          },
        },
        { provide: AuthService, useValue: authServiceStub() },
        { provide: CLOCK, useValue: () => now },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EventPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the event named by the route and renders it with the form', async () => {
    const fixture = await setup('intro-to-kubernetes');

    const request = http.expectOne(
      eventDetailEndpoint('acme', 'intro-to-kubernetes'),
    );
    expect(request.request.method).toBe('GET');
    request.flush({ event });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Intro to Kubernetes');
    expect(text).toContain('Save your spot');
    expect(
      fixture.nativeElement.querySelector('#registration-email'),
    ).toBeTruthy();
    http.verify();
  });

  it('links to the organizer page', async () => {
    const fixture = await setup('intro-to-kubernetes');
    http
      .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
      .flush({ event, org: { orgId: 'org_1', name: 'Acme', slug: 'acme' } });

    await fixture.whenStable();
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector(
      'a[href="/acme"]',
    );
    expect(link?.textContent?.trim()).toBe('Acme');
  });

  describe('once the event is over', () => {
    const afterTheEvent = new Date('2026-09-11T13:30:00.000Z');

    async function renderEnded(loaded: PublicEvent) {
      const fixture = await setup('intro-to-kubernetes', 'acme', afterTheEvent);
      http
        .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
        .flush({ event: loaded });
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    }

    it('keeps the page but swaps the form for an ended notice', async () => {
      const fixture = await renderEnded(event);

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Intro to Kubernetes');
      expect(text).toContain('This event has ended');
      expect(
        fixture.nativeElement.querySelector('#registration-email'),
      ).toBeNull();
      http.verify();
    });

    it('drops the external registration link too', async () => {
      const fixture = await renderEnded({
        ...event,
        externalUrl: 'https://www.meetup.com/example/events/1',
        sourceName: 'Meetup',
      });

      expect(fixture.nativeElement.textContent).toContain(
        'This event has ended',
      );
      expect(
        fixture.nativeElement.querySelector(
          'a[href^="https://www.meetup.com"]',
        ),
      ).toBeNull();
    });

    it('still offers the form while inside the three-hour grace window', async () => {
      const fixture = await setup(
        'intro-to-kubernetes',
        'acme',
        new Date('2026-09-10T15:30:00.000Z'),
      );
      http
        .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
        .flush({ event });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('#registration-email'),
      ).toBeTruthy();
    });
  });

  it('sets the document title from the loaded event', async () => {
    const fixture = await setup('intro-to-kubernetes');
    http
      .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
      .flush({ event });

    await fixture.whenStable();

    expect(TestBed.inject(Title).getTitle()).toBe(
      'Intro to Kubernetes · Upskills',
    );
  });

  it('publishes the event description and canonical URL for SEO', async () => {
    const fixture = await setup('intro-to-kubernetes');
    http
      .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
      .flush({ event });

    await fixture.whenStable();

    expect(TestBed.inject(Meta).getTag('name="description"')?.content).toBe(
      'A hands-on afternoon.',
    );

    const canonical = TestBed.inject(DOCUMENT).head.querySelector(
      'link[rel="canonical"]',
    );
    expect(canonical?.getAttribute('href')).toBe(
      'https://upskillsnetwork.com/acme/intro-to-kubernetes',
    );
  });

  it('escapes the slug so a path segment cannot be smuggled into the URL', async () => {
    const fixture = await setup('../orgs/secret');

    http
      .expectOne(eventDetailEndpoint('acme', '../orgs/secret'))
      .flush({ event });
    await fixture.whenStable();

    expect(eventDetailEndpoint('acme', '../orgs/secret')).toBe(
      '/api/v1/orgs/acme/events/..%2Forgs%2Fsecret',
    );
  });

  it('shows a not-found page for a slug the API refuses', async () => {
    const fixture = await setup('no-such-workshop');

    http
      .expectOne(eventDetailEndpoint('acme', 'no-such-workshop'))
      .flush(
        { data: { error: 'event-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain("couldn't find that workshop");
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('separates a server failure from a missing event', async () => {
    const fixture = await setup('intro-to-kubernetes');

    http
      .expectOne(eventDetailEndpoint('acme', 'intro-to-kubernetes'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Something went wrong');
    expect(text).not.toContain("couldn't find that workshop");
  });

  it('recognises a 404 that arrives as an ofetch FetchError, not an HttpErrorResponse', async () => {
    // What production SSR actually throws: Analog routes the request through
    // Nitro's in-process $fetch, and ofetch rejects with its own error class.
    // Classifying this as a server failure showed "Something went wrong" on
    // every unknown slug in production while every local run looked correct.
    const fetchError = Object.assign(
      new Error('[GET] "/api/v1/events/x": 404'),
      {
        statusCode: 404,
        status: 404,
        data: {
          error: true,
          statusCode: 404,
          data: { error: 'event-not-found' },
        },
      },
    );

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: { get: () => throwError(() => fetchError) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({
                orgSlug: 'acme',
                eventSlug: 'no-such-workshop',
              }),
            },
          },
        },
        { provide: AuthService, useValue: authServiceStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain("couldn't find that workshop");
    expect(text).not.toContain('Something went wrong');
  });

  it('does not call the API when the route carries no slug', async () => {
    const fixture = await setup(null);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that workshop",
    );
    http.verify();
  });
});
