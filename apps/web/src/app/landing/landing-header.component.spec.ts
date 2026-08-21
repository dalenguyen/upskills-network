import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, type AuthUser } from '../auth/auth-service';
import { LandingHeaderComponent } from './landing-header.component';

const signedInUser: AuthUser = {
  uid: 'uid-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  emailVerified: true,
};

describe('LandingHeaderComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(
    user: AuthUser | null = null,
    meRole: 'admin' | 'user' = 'user',
  ) {
    TestBed.resetTestingModule();

    const auth = {
      user: signal<AuthUser | null>(user),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const http = {
      get: vi.fn().mockReturnValue(of({ user: { role: meRole }, orgs: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [LandingHeaderComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: HttpClient, useValue: http },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(LandingHeaderComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { auth, fixture, navigateByUrl };
  }

  function signOutButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      root.querySelectorAll<HTMLButtonElement>('button'),
    ).filter((button) => button.textContent?.trim() === 'Sign out');
  }

  function menuButton(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>('button[aria-label="Menu"]');
  }

  it('renders the wordmark', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills');
  });

  it('no longer shows a waitlist call-to-action anywhere in the header', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="/#waitlist"]')).toBeNull();
    expect(root.textContent).not.toContain('Join the waitlist');
  });

  it('links to sign-in outside the mobile menu, for desktop', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    const signInLinks = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[href="/auth/login"]'),
    );
    expect(signInLinks).toHaveLength(2);
    expect(
      signInLinks.some((link) => link.closest('#mobile-menu') === null),
    ).toBe(true);
  });

  // `/events` only lives in the mobile menu now — the always-visible row on
  // small screens is just the wordmark and the hamburger toggle.
  it('puts the Events link inside the mobile menu', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector<HTMLElement>('#mobile-menu');

    expect(menu?.querySelector('a[href="/events"]')).toBeTruthy();
  });

  it('shows the sign-in link and no sign-out button when signed out', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(signOutButtons(root)).toHaveLength(0);
  });

  it('hides the admin link when the signed-in user is not a platform admin', async () => {
    const { fixture } = await setup(signedInUser, 'user');

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('a[href="/admin/orgs"]')).toBeNull();
  });

  it('shows the admin link in the mobile menu when the signed-in user is a platform admin', async () => {
    const { fixture } = await setup(signedInUser, 'admin');

    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector<HTMLElement>('#mobile-menu');

    expect(menu?.querySelector('a[href="/admin/orgs"]')).toBeTruthy();
  });

  it('hides the admin link when signed out', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('a[href="/admin/orgs"]')).toBeNull();
  });

  it('shows the display name, a sign-out button, and no sign-in link when signed in', async () => {
    const { fixture } = await setup(signedInUser);

    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Ada Lovelace');
    expect(signOutButtons(root).length).toBeGreaterThan(0);
    expect(root.querySelector('a[href="/auth/login"]')).toBeNull();

    const dashboardLinks = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[href="/dashboard"]'),
    );
    expect(dashboardLinks.length).toBeGreaterThan(0);
    expect(root.querySelector('a[href="/#waitlist"]')).toBeNull();
  });

  it('falls back to email when the signed-in user has no display name', async () => {
    const { fixture } = await setup({
      ...signedInUser,
      displayName: null,
    });

    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('ada@example.com');
    expect(root.textContent).not.toContain('Account');
  });

  it('falls back to Account when the signed-in user has no display name or email', async () => {
    const { fixture } = await setup({
      ...signedInUser,
      displayName: null,
      email: null,
    });

    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Account');
  });

  it('signs out and navigates home when the sign-out button is clicked', async () => {
    const { auth, fixture, navigateByUrl } = await setup(signedInUser);

    const root = fixture.nativeElement as HTMLElement;
    signOutButtons(root)[0].click();
    await fixture.whenStable();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('still navigates home when the server session teardown rejects', async () => {
    const { auth, fixture, navigateByUrl } = await setup(signedInUser);
    auth.logout.mockRejectedValue(new Error('session teardown failed'));

    const root = fixture.nativeElement as HTMLElement;
    signOutButtons(root)[0].click();
    await fixture.whenStable();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('disables the sign-out button while logout is in flight', async () => {
    const { auth, fixture, navigateByUrl } = await setup(signedInUser);

    let resolveLogout!: () => void;
    auth.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );

    const root = fixture.nativeElement as HTMLElement;
    const button = signOutButtons(root)[0];
    expect(button.disabled).toBe(false);

    button.click();
    // Note this assertion cannot tell a signal from a plain field: TestBed runs
    // change detection on `whenStable()` either way. It pins the behaviour, not
    // the mechanism — the mechanism is checked by serving the app.
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    expect(navigateByUrl).not.toHaveBeenCalled();

    resolveLogout();
    await fixture.whenStable();
  });

  // Everything nav-related — sections, Events, Admin, sign in/out, the CTA —
  // now lives in the mobile menu; the always-visible row on small screens is
  // just the wordmark and the hamburger toggle.
  it('collapses the mobile Events, Admin, and sign-out links into a hidden menu', async () => {
    const { fixture } = await setup(signedInUser, 'admin');

    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector<HTMLElement>('#mobile-menu');

    expect(menu).toBeTruthy();
    expect(menu?.hidden).toBe(true);
    expect(menu?.querySelector('a[href="/events"]')).toBeTruthy();
    expect(menu?.querySelector('a[href="/admin/orgs"]')).toBeTruthy();
    expect(
      Array.from(menu?.querySelectorAll('button') ?? []).some(
        (button) => button.textContent?.trim() === 'Sign out',
      ),
    ).toBe(true);
  });

  it('toggles the mobile menu from the menu button', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    const button = menuButton(root);
    const menu = root.querySelector<HTMLElement>('#mobile-menu');

    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.hidden).toBe(true);

    button?.click();
    fixture.detectChanges();

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(menu?.hidden).toBe(false);

    button?.click();
    fixture.detectChanges();

    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.hidden).toBe(true);
  });

  it('includes sign-in inside the mobile menu', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector<HTMLElement>('#mobile-menu');

    expect(menu?.querySelector('a[href="/auth/login"]')).toBeTruthy();
  });
});
