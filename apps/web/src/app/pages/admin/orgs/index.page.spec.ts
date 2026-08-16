import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  adminOrgCreateEndpoint,
  adminOrgsEndpoint,
  type AdminOrg,
} from '../../../admin/orgs-api';
import AdminOrgsPageComponent from './index.page';

/** One organizer as the admin org routes serialize it. */
function adminOrg(overrides: Partial<AdminOrg> = {}): AdminOrg {
  return {
    orgId: 'org_1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-admin',
    members: {
      'uid-admin': { role: 'admin', addedAt: '2026-01-01T00:00:00.000Z' },
    },
    memberUids: ['uid-admin'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AdminOrgsPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [AdminOrgsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminOrgsPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  async function loadPage(
    fixture: ComponentFixture<AdminOrgsPageComponent>,
    http: HttpTestingController,
    orgs: AdminOrg[] = [adminOrg()],
  ): Promise<void> {
    const request = http.expectOne(adminOrgsEndpoint());
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ orgs });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(
    fixture: ComponentFixture<AdminOrgsPageComponent>,
    selector: string,
    value: string,
  ): void {
    const root = fixture.nativeElement as HTMLElement;
    const element = root.querySelector<HTMLInputElement>(selector);

    if (element === null) {
      throw new Error(`No form control matches ${selector}`);
    }

    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function submitButton(
    fixture: ComponentFixture<AdminOrgsPageComponent>,
  ): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    const button = Array.from(buttons).find(
      (candidate) => candidate.textContent?.trim() === 'Create organizer',
    );

    if (button === undefined) {
      throw new Error('No create organizer submit button');
    }

    return button;
  }

  it('lists every org name and slug, linking each name to its admin page', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, [
      adminOrg(),
      adminOrg({
        orgId: 'org_2',
        name: 'Upskills Ottawa',
        slug: 'upskills-ottawa',
      }),
    ]);

    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows).toHaveLength(2);

    const firstRow = rows[0];
    expect(firstRow.textContent).toContain('Upskills Toronto');
    expect(firstRow.textContent).toContain('upskills-toronto');
    expect(firstRow.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/orgs/org_1',
    );

    const secondRow = rows[1];
    expect(secondRow.textContent).toContain('Upskills Ottawa');
    expect(secondRow.textContent).toContain('upskills-ottawa');
    expect(secondRow.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/orgs/org_2',
    );
    http.verify();
  });

  it('renders an empty state distinct from the create form when no orgs exist', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, []);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No organizers yet');
    expect(root.querySelector('tbody')).toBeNull();
    expect(root.querySelector('form')).toBeTruthy();
    http.verify();
  });

  it('posts { name, slug } and refreshes the list with the new organizer', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#name', '  Upskills Ottawa  ');
    setValue(fixture, '#slug', '  upskills-ottawa  ');

    submitButton(fixture).click();
    fixture.detectChanges();

    const createRequest = http.expectOne(adminOrgCreateEndpoint());
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.withCredentials).toBe(true);
    expect(createRequest.request.body).toEqual({
      name: 'Upskills Ottawa',
      slug: 'upskills-ottawa',
    });
    createRequest.flush({
      org: adminOrg({
        orgId: 'org_2',
        name: 'Upskills Ottawa',
        slug: 'upskills-ottawa',
      }),
    });

    await Promise.resolve();

    const refetch = http.expectOne(adminOrgsEndpoint());
    expect(refetch.request.withCredentials).toBe(true);
    refetch.flush({
      orgs: [
        adminOrg(),
        adminOrg({
          orgId: 'org_2',
          name: 'Upskills Ottawa',
          slug: 'upskills-ottawa',
        }),
      ],
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows).toHaveLength(2);
    expect(root.querySelector<HTMLInputElement>('#name')?.value).toBe('');
    expect(root.querySelector<HTMLInputElement>('#slug')?.value).toBe('');
    http.verify();
  });

  it('names the slug field specifically for a SlugTakenError', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    setValue(fixture, '#name', 'Upskills Ottawa');
    setValue(fixture, '#slug', 'upskills-ottawa');

    submitButton(fixture).click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgCreateEndpoint())
      .flush(
        { data: { error: 'slug-taken' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('That slug is already taken');
    expect(text).not.toContain(
      'Something went wrong while creating the organizer',
    );
    expect(submitButton(fixture).disabled).toBe(false);
    http.verify();
  });

  it('explains the slug rules for an invalid-slug failure', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    setValue(fixture, '#name', 'Upskills Ottawa');
    setValue(fixture, '#slug', 'Not A Slug');

    submitButton(fixture).click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgCreateEndpoint())
      .flush(
        { data: { error: 'invalid-slug' } },
        { status: 400, statusText: 'Bad Request' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('That slug is not usable');
    expect(text).toContain('Lowercase letters, numbers, and hyphens only');
    expect(text).not.toContain(
      'Something went wrong while creating the organizer',
    );
    http.verify();
  });

  it('explains the one-organizer limit for an OrgLimitExceededError', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);
    setValue(fixture, '#name', 'Upskills Ottawa');
    setValue(fixture, '#slug', 'upskills-ottawa');

    submitButton(fixture).click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgCreateEndpoint())
      .flush(
        { data: { error: 'org-limit-exceeded' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('already belongs to an organizer');
    expect(text).not.toContain(
      'Something went wrong while creating the organizer',
    );
    http.verify();
  });

  it('shows a permission message when the list request answers 403', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgsEndpoint())
      .flush(
        { data: { error: 'forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      "You don't have permission to view this page",
    );
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('shows only a failure message when the list request fails', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgsEndpoint())
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Something went wrong');
    expect(root.textContent).not.toContain('Upskills Toronto');
    expect(root.querySelector('tbody')).toBeNull();
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });
});
