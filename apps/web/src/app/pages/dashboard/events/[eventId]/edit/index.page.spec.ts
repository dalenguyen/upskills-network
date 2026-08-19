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
  Router,
} from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dashboardEventDetailEndpoint,
  dashboardEventUpdateEndpoint,
  meEndpoint,
  type MeGetResponse,
} from '../../../../../dashboard/dashboard-api';
import {
  meResponse,
  workshop,
} from '../../../../../dashboard/testing/dashboard-fixtures';
import DashboardEventsEditPageComponent, {
  centsToDollars,
  toLocalDatetimeValue,
} from './index.page';

describe('DashboardEventsEditPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(eventId: string | null = 'evt_1') {
    await TestBed.configureTestingModule({
      imports: [DashboardEventsEditPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(eventId === null ? {} : { eventId }),
            },
          },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(DashboardEventsEditPageComponent);
    fixture.detectChanges();

    return { fixture, http, navigateByUrl };
  }

  async function loadMe(
    fixture: ComponentFixture<DashboardEventsEditPageComponent>,
    http: HttpTestingController,
    me: MeGetResponse = meResponse,
  ): Promise<void> {
    const request = http.expectOne(meEndpoint());
    expect(request.request.withCredentials).toBe(true);
    request.flush(me);

    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function loadPage(
    fixture: ComponentFixture<DashboardEventsEditPageComponent>,
    http: HttpTestingController,
    me: MeGetResponse = meResponse,
    item = workshop(),
  ): Promise<void> {
    const meRequest = http.expectOne(meEndpoint());
    expect(meRequest.request.withCredentials).toBe(true);
    meRequest.flush(me);
    await Promise.resolve();

    const detailRequest = http.expectOne(
      dashboardEventDetailEndpoint('org_1', 'evt_1'),
    );
    expect(detailRequest.request.withCredentials).toBe(true);
    detailRequest.flush({ event: item });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(
    fixture: ComponentFixture<DashboardEventsEditPageComponent>,
    selector: string,
    value: string,
  ): void {
    const root = fixture.nativeElement as HTMLElement;
    const element = root.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(selector);

    if (element === null) {
      throw new Error(`No form control matches ${selector}`);
    }

    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function buttonByText(
    fixture: ComponentFixture<DashboardEventsEditPageComponent>,
    text: string,
  ): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    const button = Array.from(buttons).find(
      (candidate) => candidate.textContent?.trim() === text,
    );

    if (button === undefined) {
      throw new Error(`No button with text ${text}`);
    }

    return button;
  }

  function fillRequiredFields(
    fixture: ComponentFixture<DashboardEventsEditPageComponent>,
  ): void {
    setValue(fixture, '#title', 'Rust for the web');
    setValue(fixture, '#slug', 'rust-for-the-web');
    setValue(fixture, '#description', 'A hands-on afternoon.');
    setValue(fixture, '#startsAt', '2026-09-01T18:00');
    setValue(fixture, '#price', '49.50');
    setValue(fixture, '#maxGuests', '20');
  }

  describe('toLocalDatetimeValue', () => {
    it('renders a UTC instant in the event local zone', () => {
      expect(
        toLocalDatetimeValue('2026-09-10T13:30:00.000Z', 'America/Toronto'),
      ).toBe('2026-09-10T09:30');
    });

    it('renders a UTC instant in a winter-offset local zone', () => {
      expect(
        toLocalDatetimeValue('2026-01-10T13:30:00.000Z', 'America/Toronto'),
      ).toBe('2026-01-10T08:30');
    });

    it('renders UTC unchanged for the UTC zone', () => {
      expect(toLocalDatetimeValue('2026-09-10T13:30:00.000Z', 'UTC')).toBe(
        '2026-09-10T13:30',
      );
    });
  });

  describe('centsToDollars', () => {
    it('converts integer cents to a two-decimal dollar string', () => {
      expect(centsToDollars(4950)).toBe('49.50');
      expect(centsToDollars(0)).toBe('0.00');
      expect(centsToDollars(1999)).toBe('19.99');
    });
  });

  it('pre-fills every field from the loaded event with dollars and local time', async () => {
    const { fixture, http } = await setup();
    await loadPage(
      fixture,
      http,
      meResponse,
      workshop({
        title: 'Intro to Kubernetes',
        slug: 'intro-to-kubernetes',
        description: 'A hands-on afternoon.',
        startsAt: '2026-09-10T13:30:00.000Z',
        endsAt: '2026-09-10T16:30:00.000Z',
        timezone: 'America/Toronto',
        location: 'Toronto Reference Library',
        price: 4950,
        maxGuests: 20,
      }),
    );

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Edit event');
    expect(root.querySelector<HTMLInputElement>('#title')?.value).toBe(
      'Intro to Kubernetes',
    );
    expect(root.querySelector<HTMLInputElement>('#slug')?.value).toBe(
      'intro-to-kubernetes',
    );
    expect(root.querySelector<HTMLTextAreaElement>('#description')?.value).toBe(
      'A hands-on afternoon.',
    );
    expect(root.querySelector<HTMLInputElement>('#startsAt')?.value).toBe(
      '2026-09-10T09:30',
    );
    expect(root.querySelector<HTMLInputElement>('#endsAt')?.value).toBe(
      '2026-09-10T12:30',
    );
    expect(root.querySelector<HTMLSelectElement>('#timezone')?.value).toBe(
      'America/Toronto',
    );
    expect(root.querySelector<HTMLInputElement>('#location')?.value).toBe(
      'Toronto Reference Library',
    );
    expect(root.querySelector<HTMLInputElement>('#price')?.value).toBe('49.50');
    expect(root.querySelector<HTMLInputElement>('#maxGuests')?.value).toBe(
      '20',
    );
    http.verify();
  });

  it('shows the no-orgs state and does not call the detail route', async () => {
    const { fixture, http } = await setup();
    await loadMe(fixture, http, { ...meResponse, orgs: [] });

    expect(fixture.nativeElement.textContent).toContain(
      'not a member of an organizer yet',
    );
    http.verify();
  });

  it('shows the forbidden state instead of the form for a volunteer', async () => {
    const { fixture, http } = await setup();
    const volunteerResponse: MeGetResponse = {
      ...meResponse,
      orgs: [
        {
          orgId: 'org_1',
          name: 'Upskills Toronto',
          slug: 'upskills-toronto',
          role: 'volunteer',
        },
      ],
    };

    await loadMe(fixture, http, volunteerResponse);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      "You don't have permission to edit events",
    );
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('treats a 403 detail response as not-found', async () => {
    const { fixture, http } = await setup();
    const meRequest = http.expectOne(meEndpoint());
    meRequest.flush(meResponse);
    await Promise.resolve();

    http
      .expectOne(dashboardEventDetailEndpoint('org_1', 'evt_1'))
      .flush(
        { data: { error: 'event-forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("couldn't find that event");
    expect(root.textContent).toContain("don't have permission to edit");
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('refuses to render the form for a cancelled event', async () => {
    const { fixture, http } = await setup();
    await loadPage(
      fixture,
      http,
      meResponse,
      workshop({ status: 'cancelled' }),
    );

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('This event has been cancelled');
    expect(root.textContent).not.toContain('Edit event');
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('shows an error when the detail request fails with a server error', async () => {
    const { fixture, http } = await setup();
    const meRequest = http.expectOne(meEndpoint());
    meRequest.flush(meResponse);
    await Promise.resolve();

    http
      .expectOne(dashboardEventDetailEndpoint('org_1', 'evt_1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Something went wrong');
    expect(root.textContent).not.toContain('Edit event');
    http.verify();
  });

  it('shows not-found without calling the API when the route carries no eventId', async () => {
    const { fixture, http } = await setup(null);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that event",
    );
    http.verify();
  });

  it('puts a draft with dollars converted to cents and omits empty endsAt and location', async () => {
    const { fixture, http, navigateByUrl } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Save as draft').click();
    fixture.detectChanges();

    const request = http.expectOne(
      dashboardEventUpdateEndpoint('org_1', 'evt_1'),
    );
    expect(request.request.method).toBe('PUT');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      title: 'Rust for the web',
      slug: 'rust-for-the-web',
      description: 'A hands-on afternoon.',
      startsAt: '2026-09-01T18:00:00-04:00',
      timezone: 'America/Toronto',
      // Sent even when empty, unlike `endsAt` and `location`: an absent field
      // means "leave it alone", so an empty string is the only way this form
      // can express "remove the image".
      imageUrl: '',
      price: 4950,
      currency: 'cad',
      maxGuests: 20,
      status: 'draft',
    });

    request.flush({ event: workshop({ slug: 'rust-for-the-web' }) });

    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
    http.verify();
  });

  it('puts published status with endsAt and location when provided', async () => {
    const { fixture, http, navigateByUrl } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);
    setValue(fixture, '#endsAt', '2026-09-01T21:00');
    setValue(fixture, '#location', 'Toronto Reference Library');

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    const request = http.expectOne(
      dashboardEventUpdateEndpoint('org_1', 'evt_1'),
    );
    expect(request.request.body).toMatchObject({
      endsAt: '2026-09-01T21:00:00-04:00',
      location: 'Toronto Reference Library',
      status: 'published',
    });

    request.flush({
      event: workshop({ slug: 'rust-for-the-web', status: 'published' }),
    });

    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
    http.verify();
  });

  it('names the slug field specifically for a 409 conflict', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    http
      .expectOne(dashboardEventUpdateEndpoint('org_1', 'evt_1'))
      .flush({}, { status: 409, statusText: 'Conflict' });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('slug');
    expect(text).toContain('already taken');
    http.verify();
  });
});
