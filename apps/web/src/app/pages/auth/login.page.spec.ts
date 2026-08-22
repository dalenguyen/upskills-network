import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, type AuthUser } from '../../auth/auth-service';
import LoginPageComponent from './login.page';

const signedInUser: AuthUser = {
  uid: 'uid-1',
  email: 'ada@example.com',
  displayName: null,
  emailVerified: true,
};

describe('LoginPageComponent', () => {
  async function setup(params: Record<string, string> = {}) {
    TestBed.resetTestingModule();

    const auth = {
      user: signal<AuthUser | null>(null),
      ready: signal(true),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      loginWithEmail: vi.fn(async () => signedInUser),
      loginWithGoogle: vi.fn(async () => signedInUser),
    };

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(params),
            },
          },
        },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();

    return { auth, fixture, navigateByUrl };
  }

  function submitButton(
    fixture: ComponentFixture<LoginPageComponent>,
  ): HTMLButtonElement | null {
    return Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('button'),
    ).find(
      (button) => button.getAttribute('type') === 'submit',
    ) as HTMLButtonElement | null;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('signs in with email and password and returns to the requested page', async () => {
    const { auth, fixture, navigateByUrl } = await setup({
      redirectTo: '/dashboard/events',
    });

    fixture.componentInstance.form.setValue({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();

    expect(auth.loginWithEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'correct horse battery staple',
    );
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
  });

  it('defaults the post-sign-in redirect to the dashboard', async () => {
    const { auth, fixture, navigateByUrl } = await setup();

    fixture.componentInstance.form.setValue({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();

    expect(auth.loginWithEmail).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('ignores a protocol-relative redirectTo and falls back to the dashboard', async () => {
    const { auth, fixture, navigateByUrl } = await setup({
      redirectTo: '//evil.example.com',
    });

    fixture.componentInstance.form.setValue({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();

    expect(auth.loginWithEmail).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('continues with Google and returns to the requested page', async () => {
    const { auth, fixture, navigateByUrl } = await setup({
      redirectTo: '/dashboard/events',
    });

    const googleButton = Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('Continue with Google')) as
      HTMLButtonElement | undefined;

    expect(googleButton).toBeTruthy();
    googleButton!.click();
    await fixture.whenStable();

    expect(auth.loginWithGoogle).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
  });

  it('shows an account-neutral error without leaking the Firebase code or message', async () => {
    const { auth, fixture } = await setup();
    auth.loginWithEmail.mockRejectedValue({
      code: 'auth/user-not-found',
      message: 'There is no user record corresponding to this identifier.',
    });

    fixture.componentInstance.form.setValue({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain("That email and password don't match an account.");
    expect(text).not.toContain('auth/user-not-found');
    expect(text).not.toContain('There is no user record');
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("That email and password don't match an account.");
  });

  it('disables the submit button while a sign-in is in flight', async () => {
    const { auth, fixture } = await setup();

    let resolveSignIn!: (user: AuthUser) => void;
    auth.loginWithEmail.mockImplementation(
      () =>
        new Promise<AuthUser>((resolve) => {
          resolveSignIn = resolve;
        }),
    );

    fixture.componentInstance.form.setValue({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });
    fixture.detectChanges();

    const button = submitButton(fixture);
    expect(button?.disabled).toBe(false);

    const pending = fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(button?.disabled).toBe(true);

    resolveSignIn(signedInUser);
    await pending;
  });

  it('disables the submit button while the form is invalid', async () => {
    const { fixture } = await setup();

    fixture.componentInstance.form.setValue({ email: '', password: '' });
    fixture.detectChanges();

    const button = submitButton(fixture);
    expect(button?.disabled).toBe(true);
  });

  it('links to registration preserving the redirectTo query param', async () => {
    const { fixture } = await setup({ redirectTo: '/dashboard/events' });

    expect(
      fixture.nativeElement.querySelector(
        'a[href="/auth/register?redirectTo=%2Fdashboard%2Fevents"]',
      ),
    ).toBeTruthy();
  });

  it('sets the page title', async () => {
    await setup();

    expect(TestBed.inject(Title).getTitle()).toBe('Sign in · Upskills');
  });
});
