import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  inviteAcceptEndpoint,
  inviteDetailEndpoint,
  type InviteDetailResponse,
} from '../../invites/invites-api';
import InviteAcceptPageComponent from './[token].page';

/**
 * The page an invitation email lands on.
 *
 * It is not behind `authGuard` on purpose — see the component's own comment —
 * so the tests below cover what an unauthenticated visitor sees as well as what
 * happens when the accept call is refused.
 */

const INVITE: InviteDetailResponse = {
  invite: {
    orgName: 'Upskills Toronto',
    role: 'manager',
    email: 'grace@example.com',
    expiresAt: '2026-09-08T18:00:00.000Z',
  },
};

describe('InviteAcceptPageComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(token: string | null = 'tok-1') {
    await TestBed.configureTestingModule({
      imports: [InviteAcceptPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(token === null ? {} : { token }),
            },
          },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InviteAcceptPageComponent);
    fixture.detectChanges();

    return { fixture, http };
  }

  async function loadPage(
    fixture: Awaited<ReturnType<typeof setup>>['fixture'],
    http: HttpTestingController,
    body: InviteDetailResponse = INVITE,
  ): Promise<HTMLElement> {
    const request = http.expectOne(inviteDetailEndpoint('tok-1'));
    expect(request.request.method).toBe('GET');
    request.flush(body);

    await fixture.whenStable();
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  function acceptButton(root: HTMLElement): HTMLButtonElement {
    const button = Array.from(root.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Accept invitation',
    );

    if (button === undefined) {
      throw new Error('No accept button');
    }

    return button;
  }

  it('shows the org, the role, and which address to sign in with', async () => {
    const { fixture, http } = await setup();
    const root = await loadPage(fixture, http);

    expect(root.textContent).toContain('Join Upskills Toronto');
    expect(root.textContent).toContain('manager');
    expect(root.textContent).toContain('grace@example.com');
    http.verify();
  });

  it('accepts with a POST and confirms the new membership', async () => {
    const { fixture, http } = await setup();
    const root = await loadPage(fixture, http);

    acceptButton(root).click();
    fixture.detectChanges();

    const request = http.expectOne(inviteAcceptEndpoint('tok-1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      orgId: 'org_1',
      orgName: 'Upskills Toronto',
      role: 'manager',
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).toContain("You've joined Upskills Toronto");
    expect(root.querySelector('a[href="/dashboard"]')).not.toBeNull();
    http.verify();
  });

  it('asks an unauthenticated visitor to sign in when accepting answers 401', async () => {
    const { fixture, http } = await setup();
    const root = await loadPage(fixture, http);

    acceptButton(root).click();
    fixture.detectChanges();

    http
      .expectOne(inviteAcceptEndpoint('tok-1'))
      .flush(
        { data: { error: 'invalid-session', reason: 'expired' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).toContain(
      'Sign in with the invited email address',
    );
    http.verify();
  });

  it('names the mismatch when a different account tries to accept', async () => {
    const { fixture, http } = await setup();
    const root = await loadPage(fixture, http);

    acceptButton(root).click();
    fixture.detectChanges();

    http
      .expectOne(inviteAcceptEndpoint('tok-1'))
      .flush(
        { data: { error: 'invite-email-mismatch' } },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).toContain('sent to a different email address');
    http.verify();
  });

  it('explains a spent invitation instead of offering to accept it', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(inviteDetailEndpoint('tok-1'))
      .flush(
        { data: { error: 'invite-not-pending' } },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("This invitation can't be used");
    expect(root.querySelector('main button')).toBeNull();
    http.verify();
  });

  it('shows a not-found message for a token nobody was sent', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(inviteDetailEndpoint('tok-1'))
      .flush(
        { data: { error: 'invite-not-found' } },
        { status: 404, statusText: 'Not Found' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that invitation",
    );
    http.verify();
  });

  it('shows a failure message when the detail request fails', async () => {
    const { fixture, http } = await setup();

    http
      .expectOne(inviteDetailEndpoint('tok-1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Something went wrong');
    http.verify();
  });

  it('calls nothing when the route carries no token', async () => {
    const { fixture, http } = await setup(null);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't find that invitation",
    );
    http.verify();
  });
});
