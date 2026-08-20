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
  dashboardEventDetailEndpoint,
  dashboardEventGuestsEndpoint,
  dashboardOrgDetailEndpoint,
  meEndpoint,
  type DashboardEventsGuestsResponse,
} from '../../../../../dashboard/dashboard-api';
import {
  dashboardOrg,
  meResponse,
  workshop,
} from '../../../../../dashboard/testing/dashboard-fixtures';
import DashboardEventsGuestsPageComponent from './index.page';

function guest(
  overrides: Partial<DashboardEventsGuestsResponse['guests'][number]> = {},
): DashboardEventsGuestsResponse['guests'][number] {
  return {
    name: 'Ada Lovelace',
    status: 'confirmed',
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DashboardEventsGuestsPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(
    eventId: string | null = 'evt_1',
    query: Record<string, string> = {},
  ) {
    await TestBed.configureTestingModule({
      imports: [DashboardEventsGuestsPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(eventId === null ? {} : { eventId }),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DashboardEventsGuestsPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  function flushEventAndGuests(
    http: HttpTestingController,
    orgId: string,
    eventId: string,
    guests: DashboardEventsGuestsResponse['guests'] = [guest()],
  ): void {
    http
      .expectOne(dashboardEventDetailEndpoint(orgId, eventId))
      .flush({ event: workshop({ orgId }) });
    http
      .expectOne(dashboardEventGuestsEndpoint(orgId, eventId))
      .flush({ guests });
  }

  it('loads a URL-named org without reading the viewer memberships', async () => {
    const { fixture, http } = await setup('evt_1', { orgId: 'org_9' });

    const org = dashboardOrg({
      orgId: 'org_9',
      name: 'Upskills Montreal',
      slug: 'upskills-montreal',
    });
    http
      .expectOne(dashboardOrgDetailEndpoint('org_9'))
      .flush({ org, invites: [] });
    await Promise.resolve();
    flushEventAndGuests(http, 'org_9', 'evt_1');

    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills Montreal');
    expect(root.textContent).toContain('Intro to Kubernetes');
    expect(root.textContent).toContain('Ada Lovelace');
    expect(root.textContent).toContain('confirmed');
    http.expectNone(meEndpoint());
    http.verify();
  });

  it('still resolves the org from me when the URL carries no orgId', async () => {
    const { fixture, http } = await setup('evt_1');

    http.expectOne(meEndpoint()).flush(meResponse);
    await Promise.resolve();

    flushEventAndGuests(http, 'org_1', 'evt_1');

    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills Toronto');
    expect(root.textContent).toContain('Intro to Kubernetes');
    expect(root.textContent).toContain('Ada Lovelace');
    http.verify();
  });

  it('treats a forbidden URL-named org as not-found', async () => {
    const { fixture, http } = await setup('evt_1', { orgId: 'org_9' });

    http
      .expectOne(dashboardOrgDetailEndpoint('org_9'))
      .flush(
        { data: { error: 'forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("couldn't find that event");
    http.expectNone(meEndpoint());
    http.verify();
  });

  it('shows not-found without calling the API when the route has no eventId', async () => {
    const { fixture, http } = await setup(null, { orgId: 'org_9' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that event",
    );
    http.verify();
  });
});
