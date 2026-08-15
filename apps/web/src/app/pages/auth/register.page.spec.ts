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
import RegisterPageComponent from './register.page';

const signedInUser: AuthUser = {
  uid: 'uid-1',
  email: 'new-arrival@example.com',
  displayName: null,
  emailVerified: false,
};

describe('RegisterPageComponent', () => {
  async function setup(params: Record<string, string> = {}) {
    TestBed.resetTestingModule();

    const auth = {
      registerWithEmail: vi.fn(async () => signedInUser),
      loginWithGoogle: vi.fn(async () => signedInUser),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterPageComponent],
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

    const fixture = TestBed.createComponent(RegisterPageComponent);
    fixture.detectChanges();

    return { auth, fixture, navigateByUrl };
  }

  function submitButton(
    fixture: ComponentFixture<RegisterPageComponent>,
  ): HTMLButtonElement | null {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) => button.getAttribute('type') === 'submit') as
      | HTMLButtonElement
      | null;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates an account with email and password and returns to the requested page', async () => {
    const { auth, fixture, navigateByUrl } = await setup({
      redirectTo: '/dashboard/events',
    });

    fixture.componentInstance.form.setValue({
      email: 'new-arrival@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();

    expect(auth.registerWithEmail).toHaveBeenCalledWith(
      'new-arrival@example.com',
      'correct horse battery staple',
    );
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
  });

  it('defaults the post-sign-in redirect to /', async () => {
    const { auth, fixture, navigateByUrl } = await setup();

    fixture.componentInstance.form.setValue({
      email: 'new-arrival@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();

    expect(auth.registerWithEmail).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('continues with Google and returns to the requested page', async () => {
    const { auth, fixture, navigateByUrl } = await setup({
      redirectTo: '/dashboard/events',
    });

    const googleButton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) =>
      button.textContent?.includes('Continue with Google'),
    ) as HTMLButtonElement | undefined;

    expect(googleButton).toBeTruthy();
    googleButton!.click();
    await fixture.whenStable();

    expect(auth.loginWithGoogle).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/events');
  });

  it('shows an email-in-use message without confirming the address is registered', async () => {
    const { auth, fixture } = await setup();
    auth.registerWithEmail.mockRejectedValue({
      code: 'auth/email-already-in-use',
      message: 'The email address is already in use by another account.',
    });

    fixture.componentInstance.form.setValue({
      email: 'new-arrival@example.com',
      password: 'correct horse battery staple',
    });

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain(
      "We couldn't create that account. Try signing in instead.",
    );
    expect(text).not.toContain('auth/email-already-in-use');
    expect(text).not.toContain('new-arrival@example.com');
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("We couldn't create that account. Try signing in instead.");
  });

  it('disables the submit button while registration is in flight', async () => {
    const { auth, fixture } = await setup();

    let resolveRegistration!: (user: AuthUser) => void;
    auth.registerWithEmail.mockImplementation(
      () =>
        new Promise<AuthUser>((resolve) => {
          resolveRegistration = resolve;
        }),
    );

    fixture.componentInstance.form.setValue({
      email: 'new-arrival@example.com',
      password: 'correct horse battery staple',
    });
    fixture.detectChanges();

    const button = submitButton(fixture);
    expect(button?.disabled).toBe(false);

    const pending = fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(button?.disabled).toBe(true);

    resolveRegistration(signedInUser);
    await pending;
  });

  it('uses new-password autocomplete on the password field', async () => {
    const { fixture } = await setup();

    const passwordInput = fixture.nativeElement.querySelector(
      'input[type="password"]',
    );

    expect(passwordInput?.getAttribute('autocomplete')).toBe('new-password');
  });

  it('links to login preserving the redirectTo query param', async () => {
    const { fixture } = await setup({ redirectTo: '/dashboard/events' });

    expect(
      fixture.nativeElement.querySelector(
        'a[href="/auth/login?redirectTo=%2Fdashboard%2Fevents"]',
      ),
    ).toBeTruthy();
  });

  it('sets the page title', async () => {
    await setup();

    expect(TestBed.inject(Title).getTitle()).toBe('Create your account · Upskills');
  });
});
