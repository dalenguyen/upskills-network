import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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

  async function setup(user: AuthUser | null = null) {
    TestBed.resetTestingModule();

    const auth = {
      user: signal<AuthUser | null>(user),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [LandingHeaderComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(LandingHeaderComponent);
    fixture.detectChanges();

    return { auth, fixture, navigateByUrl };
  }

  function signOutButton(root: HTMLElement): HTMLButtonElement | null {
    return (
      Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Sign out',
      ) ?? null
    );
  }

  it('renders the wordmark and a waitlist call-to-action anchor', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills');

    const callToAction = root.querySelector('a[href="/#waitlist"]');
    expect(callToAction?.textContent?.trim()).toBe('Join the waitlist');
  });

  it('links to sign-in, the only route into the app for a returning visitor', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    const signIn = root.querySelector('a[href="/auth/login"]');
    expect(signIn?.textContent?.trim()).toBe('Sign in');
  });

  // The section links collapse below `md`, and sign-in must not go with them:
  // no other page links to it, so a hidden link is an unreachable app.
  it('keeps sign-in outside the nav that hides on small screens', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    const signIn = root.querySelector('a[href="/auth/login"]');
    expect(signIn?.closest('nav')).toBeNull();
  });

  it('shows the sign-in link and no sign-out button when signed out', async () => {
    const { fixture } = await setup();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(signOutButton(root)).toBeNull();
  });

  it('shows the display name, a sign-out button, and no sign-in link when signed in', async () => {
    const { fixture } = await setup(signedInUser);

    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Ada Lovelace');
    expect(signOutButton(root)).toBeTruthy();
    expect(root.querySelector('a[href="/auth/login"]')).toBeNull();

    const callToAction = root.querySelector('a[href="/dashboard"]');
    expect(callToAction?.textContent?.trim()).toBe('Dashboard');
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
    signOutButton(root)!.click();
    await fixture.whenStable();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('still navigates home when the server session teardown rejects', async () => {
    const { auth, fixture, navigateByUrl } = await setup(signedInUser);
    auth.logout.mockRejectedValue(new Error('session teardown failed'));

    const root = fixture.nativeElement as HTMLElement;
    signOutButton(root)!.click();
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
    const button = signOutButton(root)!;
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

  it('keeps the sign-out button outside the nav that hides on small screens', async () => {
    const { fixture } = await setup(signedInUser);

    const root = fixture.nativeElement as HTMLElement;

    expect(signOutButton(root)?.closest('nav')).toBeNull();
  });
});
