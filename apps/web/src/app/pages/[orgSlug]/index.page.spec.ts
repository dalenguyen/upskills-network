import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicEvent, PublicOrg } from '../../events/event-api';
import { orgEndpoint } from '../../events/event-api';
import OrgPageComponent from './index.page';

const org: PublicOrg = { orgId: 'org_1', name: 'Acme Workshops', slug: 'acme' };

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    eventId: 'evt_1',
    orgId: 'org_1',
    orgSlug: 'acme',
    title: 'Intro to Kubernetes',
    slug: 'intro-to-kubernetes',
    description: 'A hands-on afternoon.',
    startsAt: '2026-10-10T13:30:00.000Z',
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 20,
    spotsRemaining: 12,
    soldOut: false,
    ...overrides,
  };
}

const page = (
  events: PublicEvent[] = [],
  nextCursor: string | null = null,
) => ({
  org,
  events,
  nextCursor,
});

describe('OrgPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(slug: string | null = 'acme') {
    await TestBed.configureTestingModule({
      imports: [OrgPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(
                slug === null ? {} : { orgSlug: slug },
              ),
            },
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OrgPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function render(
    fixture: Awaited<ReturnType<typeof setup>>,
  ): Promise<HTMLElement> {
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the organizer and their upcoming events', async () => {
    const fixture = await setup();
    http.expectOne(orgEndpoint('acme')).flush(page([event()]));
    http.expectOne(orgEndpoint('acme', undefined, 'past')).flush(page());

    const root = await render(fixture);

    expect(root.querySelector('h1')?.textContent?.trim()).toBe(
      'Acme Workshops',
    );
    expect(root.querySelectorAll('app-event-card').length).toBe(1);
    expect(root.textContent).not.toContain('Past events');
    expect(TestBed.inject(Title).getTitle()).toBe('Acme Workshops · Upskills');
    http.verify();
  });

  it('lists past events below, marked as ended', async () => {
    const fixture = await setup();
    http.expectOne(orgEndpoint('acme')).flush(page());
    http
      .expectOne(orgEndpoint('acme', undefined, 'past'))
      .flush(page([event({ eventId: 'evt_old', title: 'Last spring' })]));

    const root = await render(fixture);

    expect(root.textContent).toContain('No upcoming events');
    expect(root.textContent).toContain('Past events');
    expect(root.textContent).toContain('Last spring');
    expect(root.textContent).toContain('Ended');
  });

  it('pages each list with its own cursor', async () => {
    const fixture = await setup();
    http.expectOne(orgEndpoint('acme')).flush(page([event()], 'up-1'));
    http
      .expectOne(orgEndpoint('acme', undefined, 'past'))
      .flush(page([event({ eventId: 'evt_old' })], 'past-1'));
    await render(fixture);

    const more = fixture.componentInstance.loadMore();
    http
      .expectOne(orgEndpoint('acme', 'up-1'))
      .flush(page([event({ eventId: 'evt_2' })]));
    await more;

    const morePast = fixture.componentInstance.loadMorePast();
    http
      .expectOne(orgEndpoint('acme', 'past-1', 'past'))
      .flush(page([event({ eventId: 'evt_older' })]));
    await morePast;

    expect(fixture.componentInstance.events().length).toBe(2);
    expect(fixture.componentInstance.past()?.events.length).toBe(2);
    http.verify();
  });

  it('answers an unknown slug with a not-found message', async () => {
    const fixture = await setup('nobody');
    http
      .expectOne(orgEndpoint('nobody'))
      .flush(
        { data: { error: 'org-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );
    http
      .expectOne(orgEndpoint('nobody', undefined, 'past'))
      .flush({}, { status: 404, statusText: 'Not Found' });

    const root = await render(fixture);

    expect(root.textContent).toContain("We couldn't find that organizer");
  });

  it('shows an error when the organizer fails to load', async () => {
    const fixture = await setup();
    http
      .expectOne(orgEndpoint('acme'))
      .flush({}, { status: 500, statusText: 'Server Error' });
    http.expectOne(orgEndpoint('acme', undefined, 'past')).flush(page());

    const root = await render(fixture);

    expect(root.textContent).toContain('Something went wrong');
  });

  it('keeps the upcoming list when only the past list fails', async () => {
    const fixture = await setup();
    http.expectOne(orgEndpoint('acme')).flush(page([event()]));
    http
      .expectOne(orgEndpoint('acme', undefined, 'past'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    const root = await render(fixture);

    expect(root.querySelectorAll('app-event-card').length).toBe(1);
    expect(root.textContent).not.toContain('Past events');
    expect(root.textContent).not.toContain('Something went wrong');
  });
});
