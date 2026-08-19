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
  adminOrgDetailEndpoint,
  adminOrgMembersEndpoint,
  type AdminOrg,
  type OrgRole,
} from '../../../../admin/orgs-api';
import AdminOrgDetailPageComponent from './index.page';

/** One organizer as the admin org routes serialize it. */
function adminOrg(overrides: Partial<AdminOrg> = {}): AdminOrg {
  return {
    orgId: 'org_1',
    name: 'Upskills Toronto',
    slug: 'upskills-toronto',
    createdBy: 'uid-admin',
    members: {
      'uid-admin': {
        role: 'admin',
        addedAt: '2026-01-01T00:00:00.000Z',
        email: 'ada@example.com',
      },
      'uid-member': {
        role: 'manager',
        addedAt: '2026-01-02T00:00:00.000Z',
        email: 'grace@example.com',
      },
    },
    memberUids: ['uid-admin', 'uid-member'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One member write, then a roster update, as the member routes answer it. */
function withMember(
  org: AdminOrg,
  uid: string,
  role: OrgRole,
  email: string | null = null,
): AdminOrg {
  const addedAt = '2026-02-01T00:00:00.000Z';

  return {
    ...org,
    members: {
      ...org.members,
      [uid]: { role, addedAt, email: email ?? org.members[uid]?.email ?? null },
    },
    memberUids: Array.from(new Set([...org.memberUids, uid])),
  };
}

function withoutMember(org: AdminOrg, uid: string): AdminOrg {
  const members = { ...org.members };
  delete members[uid];

  return {
    ...org,
    members,
    memberUids: org.memberUids.filter((candidate) => candidate !== uid),
  };
}

describe('AdminOrgDetailPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(orgId: string | null = 'org_1') {
    await TestBed.configureTestingModule({
      imports: [AdminOrgDetailPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(orgId === null ? {} : { orgId }),
            },
          },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminOrgDetailPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  async function loadPage(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    http: HttpTestingController,
    org: AdminOrg = adminOrg(),
  ): Promise<void> {
    const request = http.expectOne(adminOrgDetailEndpoint('org_1'));
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ org });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    selector: string,
    value: string,
  ): void {
    const root = fixture.nativeElement as HTMLElement;
    const element = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector,
    );

    if (element === null) {
      throw new Error(`No form control matches ${selector}`);
    }

    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function buttonByText(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
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

  function buttonByLabel(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
    label: string,
  ): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );

    if (button === null) {
      throw new Error(`No button with label ${label}`);
    }

    return button;
  }

  function memberRows(
    fixture: ComponentFixture<AdminOrgDetailPageComponent>,
  ): NodeListOf<HTMLTableRowElement> {
    const root = fixture.nativeElement as HTMLElement;
    return root.querySelectorAll<HTMLTableRowElement>('tbody tr');
  }

  it('shows name, slug, createdAt, and the member roster by email and role', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills Toronto');
    expect(root.textContent).toContain('upskills-toronto');
    expect(root.textContent).toContain('2026-01-01T00:00:00.000Z');

    const rows = memberRows(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('ada@example.com');
    expect(rows[0].textContent).toContain('admin');
    expect(rows[1].textContent).toContain('grace@example.com');
    expect(rows[1].textContent).toContain('manager');
    expect(root.textContent).not.toContain('uid-admin');
    http.verify();
  });

  it('falls back to the uid for a member whose account is gone', async () => {
    const { fixture, http } = await setup();
    await loadPage(
      fixture,
      http,
      withMember(adminOrg(), 'uid-orphan', 'volunteer'),
    );

    const rows = memberRows(fixture);
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('uid-orphan');
    http.verify();
  });

  it('adds a member with a POST and refreshes the roster from the response', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#email', 'new@example.com');
    setValue(fixture, '#role', 'volunteer');

    buttonByText(fixture, 'Add member').click();
    fixture.detectChanges();

    const addRequest = http.expectOne(adminOrgMembersEndpoint('org_1'));
    expect(addRequest.request.method).toBe('POST');
    expect(addRequest.request.withCredentials).toBe(true);
    expect(addRequest.request.body).toEqual({
      email: 'new@example.com',
      role: 'volunteer',
    });
    addRequest.flush({
      org: withMember(adminOrg(), 'uid-new', 'volunteer', 'new@example.com'),
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = memberRows(fixture);
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('new@example.com');
    expect(rows[2].textContent).toContain('volunteer');
    expect(root.querySelector<HTMLInputElement>('#email')?.value).toBe('');
    expect(root.querySelector<HTMLSelectElement>('#role')?.value).toBe(
      'volunteer',
    );
    http.verify();
  });

  it('changes a member role with a PUT and updates the roster from the response', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#role-uid-member', 'volunteer');
    buttonByLabel(fixture, 'Change role for grace@example.com').click();
    fixture.detectChanges();

    const changeRequest = http.expectOne(adminOrgMembersEndpoint('org_1'));
    expect(changeRequest.request.method).toBe('PUT');
    expect(changeRequest.request.withCredentials).toBe(true);
    expect(changeRequest.request.body).toEqual({
      uid: 'uid-member',
      role: 'volunteer',
    });
    changeRequest.flush({
      org: withMember(adminOrg(), 'uid-member', 'volunteer'),
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector<HTMLSelectElement>('#role-uid-member')?.value,
    ).toBe('volunteer');
    expect(memberRows(fixture)[1].textContent).toContain('volunteer');
    http.verify();
  });

  it('removes a member with a DELETE carrying the uid in the body', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    buttonByLabel(fixture, 'Remove grace@example.com').click();
    fixture.detectChanges();

    const removeRequest = http.expectOne(adminOrgMembersEndpoint('org_1'));
    expect(removeRequest.request.method).toBe('DELETE');
    expect(removeRequest.request.withCredentials).toBe(true);
    expect(removeRequest.request.body).toEqual({ uid: 'uid-member' });
    removeRequest.flush({
      org: withoutMember(adminOrg(), 'uid-member'),
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(memberRows(fixture)).toHaveLength(1);
    expect(root.textContent).toContain('ada@example.com');
    expect(root.textContent).not.toContain('grace@example.com');
    http.verify();
  });

  it('names the last-admin conflict when demoting the last admin', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, withoutMember(adminOrg(), 'uid-member'));

    setValue(fixture, '#role-uid-admin', 'manager');
    buttonByLabel(fixture, 'Change role for ada@example.com').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'last-org-admin' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('must keep at least one admin');
    expect(root.textContent).not.toContain(
      'Something went wrong while updating the member',
    );
    expect(
      root.querySelector<HTMLSelectElement>('#role-uid-admin')?.value,
    ).toBe('admin');
    http.verify();
  });

  it('names the last-admin conflict when removing the last admin', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http, withoutMember(adminOrg(), 'uid-member'));

    buttonByLabel(fixture, 'Remove ada@example.com').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'last-org-admin' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('must keep at least one admin');
    expect(text).not.toContain(
      'Something went wrong while updating the member',
    );
    http.verify();
  });

  it('names an email that belongs to no account', async () => {
    const { fixture, http } = await setup();
    await loadPage(fixture, http);

    setValue(fixture, '#email', 'nobody@example.com');
    buttonByText(fixture, 'Add member').click();
    fixture.detectChanges();

    http
      .expectOne(adminOrgMembersEndpoint('org_1'))
      .flush(
        { data: { error: 'user-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No account with that email address',
    );
    http.verify();
  });

  it('shows a permission message when the detail request answers 403', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
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

  it('shows a not-found message when the detail request answers 404', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
      .flush(
        { data: { error: 'org-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("couldn't find that organizer");
    expect(root.querySelector('form')).toBeNull();
    http.verify();
  });

  it('shows only a failure message when the detail request fails', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(adminOrgDetailEndpoint('org_1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Something went wrong');
    expect(root.textContent).not.toContain('Upskills Toronto');
    expect(root.querySelector('tbody')).toBeNull();
    http.verify();
  });

  it('shows not-found without calling the API when the route has no orgId', async () => {
    const { fixture, http } = await setup(null);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that organizer",
    );
    http.verify();
  });
});
