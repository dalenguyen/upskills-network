import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventsEndpoint, type PublicEvent } from '../events/event-api';
import EventsPageComponent from '../pages/events/index.page';
import { WEB_MCP_ENABLED } from './web-mcp';
import { FakeModelContext, installModelContext } from './web-mcp.testing';

function event(id: string, title: string): PublicEvent {
  return {
    eventId: id,
    orgId: 'org_1',
    orgSlug: 'acme',
    title,
    slug: id,
    description: 'A hands-on afternoon.',
    startsAt: '2026-09-10T13:30:00.000Z',
    timezone: 'America/Toronto',
    price: 0,
    currency: 'cad',
    maxGuests: 20,
    spotsRemaining: 12,
    soldOut: false,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('EventsPageWebMcpDirective', () => {
  let fake: FakeModelContext;
  let uninstall: () => void;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WEB_MCP_ENABLED, useValue: true },
      ],
    }).compileComponents();

    fake = new FakeModelContext();
    uninstall = installModelContext(fake);
    http = TestBed.inject(HttpTestingController);
    TestBed.createComponent(EventsPageComponent).detectChanges();

    http
      .expectOne(eventsEndpoint())
      .flush({ events: [event('a', 'Alpha')], nextCursor: 'c1' });
    http
      .expectOne(eventsEndpoint(undefined, 'past'))
      .flush({ events: [event('p', 'Past one')], nextCursor: null });
    await settle();
  });

  afterEach(() => uninstall());

  it('reports both lists as JSON', async () => {
    await expect(fake.call('events_list_state')).resolves.toEqual({
      status: 'ready',
      upcoming: {
        count: 1,
        hasMore: true,
        events: [
          {
            title: 'Alpha',
            path: '/acme/a',
            startsAt: '2026-09-10T13:30:00.000Z',
          },
        ],
      },
      past: {
        count: 1,
        hasMore: false,
        events: [
          {
            title: 'Past one',
            path: '/acme/p',
            startsAt: '2026-09-10T13:30:00.000Z',
          },
        ],
      },
    });
  });

  it('loads every page when asked for all of a list', async () => {
    const result = fake.call('events_load_more', {
      list: 'upcoming',
      all: true,
    });

    await settle();
    http
      .expectOne(eventsEndpoint('c1'))
      .flush({ events: [event('b', 'Beta')], nextCursor: 'c2' });
    await settle();
    http
      .expectOne(eventsEndpoint('c2'))
      .flush({ events: [event('c', 'Gamma')], nextCursor: null });

    await expect(result).resolves.toMatchObject({
      upcoming: { count: 3, hasMore: false },
    });
  });

  it('says so when a page fails, instead of looping', async () => {
    const result = fake.call('events_load_more', { list: 'upcoming' });

    await settle();
    http
      .expectOne(eventsEndpoint('c1'))
      .flush('boom', { status: 500, statusText: 'Server Error' });

    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Loading more upcoming events failed. Try again.',
    });
  });

  it('rejects an unknown list with a message the agent can act on', async () => {
    await expect(
      fake.call('events_load_more', { list: 'someday' }),
    ).resolves.toEqual({
      ok: false,
      error: 'list must be "upcoming" or "past", got someday',
    });
  });
});
