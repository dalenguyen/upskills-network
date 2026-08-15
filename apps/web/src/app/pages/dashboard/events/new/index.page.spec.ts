import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dashboardEventCreateEndpoint,
  meEndpoint,
  type MeGetResponse,
} from '../../../../dashboard/dashboard-api';
import {
  meResponse,
  workshop,
} from '../../../../dashboard/testing/dashboard-fixtures';
import DashboardEventsNewPageComponent, {
  dollarsToCents,
  toIsoWithOffset,
} from './index.page';

describe('DashboardEventsNewPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [DashboardEventsNewPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(DashboardEventsNewPageComponent);
    fixture.detectChanges();

    return { fixture, http, navigateByUrl };
  }

  async function loadPage(
    fixture: ComponentFixture<DashboardEventsNewPageComponent>,
    http: HttpTestingController,
    me: MeGetResponse = meResponse,
  ): Promise<void> {
    const request = http.expectOne(meEndpoint());
    expect(request.request.withCredentials).toBe(true);
    request.flush(me);

    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(
    fixture: ComponentFixture<DashboardEventsNewPageComponent>,
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
    fixture: ComponentFixture<DashboardEventsNewPageComponent>,
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
    fixture: ComponentFixture<DashboardEventsNewPageComponent>,
  ): void {
    setValue(fixture, '#title', 'Rust for the web');
    setValue(fixture, '#slug', 'rust-for-the-web');
    setValue(fixture, '#description', 'A hands-on afternoon.');
    setValue(fixture, '#startsAt', '2026-09-01T18:00');
    setValue(fixture, '#price', '49.50');
    setValue(fixture, '#maxGuests', '20');
  }

  describe('toIsoWithOffset', () => {
    it('appends the Toronto summer offset', () => {
      expect(toIsoWithOffset('2026-09-01T18:00', 'America/Toronto')).toBe(
        '2026-09-01T18:00:00-04:00',
      );
    });

    it('appends the Toronto winter offset', () => {
      expect(toIsoWithOffset('2026-01-01T18:00', 'America/Toronto')).toBe(
        '2026-01-01T18:00:00-05:00',
      );
    });

    it('appends a zero offset for UTC', () => {
      expect(toIsoWithOffset('2026-01-01T18:00', 'UTC')).toBe(
        '2026-01-01T18:00:00+00:00',
      );
    });
  });

  describe('dollarsToCents', () => {
    it('converts whole and fractional dollar amounts to integer cents', () => {
      expect(dollarsToCents(0)).toBe(0);
      expect(dollarsToCents(49.5)).toBe(4950);
      expect(dollarsToCents(19.99)).toBe(1999);
    });
  });

  it('renders the create form for an admin member', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('New event');
    expect(root.querySelector('form')).toBeTruthy();
    expect(root.querySelector<HTMLSelectElement>('#timezone')?.value).toBe(
      'America/Toronto',
    );
    expect(
      root.querySelectorAll<HTMLOptionElement>('#timezone option'),
    ).toHaveLength(7);
    expect(buttonByText(fixture, 'Save as draft')).toBeTruthy();
    expect(buttonByText(fixture, 'Publish')).toBeTruthy();
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

    await loadPage(fixture, http, volunteerResponse);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      "You don't have permission to create events",
    );
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('posts a draft with dollars converted to cents and an explicit start offset', async () => {
    const { fixture, http, navigateByUrl } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Save as draft').click();
    fixture.detectChanges();

    const request = http.expectOne(dashboardEventCreateEndpoint('org_1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      title: 'Rust for the web',
      slug: 'rust-for-the-web',
      description: 'A hands-on afternoon.',
      startsAt: '2026-09-01T18:00:00-04:00',
      timezone: 'America/Toronto',
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

  it('posts published status when the publish button is used', async () => {
    const { fixture, http, navigateByUrl } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);
    setValue(fixture, '#endsAt', '2026-09-01T21:00');
    setValue(fixture, '#location', 'Toronto Reference Library');

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    const request = http.expectOne(dashboardEventCreateEndpoint('org_1'));
    expect(request.request.body).toMatchObject({
      endsAt: '2026-09-01T21:00:00-04:00',
      location: 'Toronto Reference Library',
      status: 'published',
    });

    request.flush({ event: workshop({ slug: 'rust-for-the-web' }) });

    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
    http.verify();
  });

  it('shows an inline 400 error, keeps the entered values, and re-enables the buttons', async () => {
    const { fixture, http, navigateByUrl } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    http
      .expectOne(dashboardEventCreateEndpoint('org_1'))
      .flush({}, { status: 400, statusText: 'Bad Request' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      'The event could not be created. Check the form and try again.',
    );
    expect(root.querySelector<HTMLInputElement>('#title')?.value).toBe(
      'Rust for the web',
    );
    expect(buttonByText(fixture, 'Save as draft').disabled).toBe(false);
    expect(buttonByText(fixture, 'Publish').disabled).toBe(false);
    expect(navigateByUrl).not.toHaveBeenCalled();
    http.verify();
  });

  it('names the slug field specifically for a 409 conflict', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    http
      .expectOne(dashboardEventCreateEndpoint('org_1'))
      .flush({}, { status: 409, statusText: 'Conflict' });

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('slug');
    expect(text).toContain('already taken');
    http.verify();
  });

  it('disables both submit buttons while a create request is in flight', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    fillRequiredFields(fixture);

    buttonByText(fixture, 'Publish').click();
    fixture.detectChanges();

    expect(buttonByText(fixture, 'Save as draft').disabled).toBe(true);
    expect(buttonByText(fixture, 'Publish').disabled).toBe(true);

    http
      .expectOne(dashboardEventCreateEndpoint('org_1'))
      .flush({ event: workshop({ slug: 'rust-for-the-web' }) });

    await fixture.whenStable();
    http.verify();
  });
});
