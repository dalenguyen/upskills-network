import type { RouteMeta } from '@analogjs/router';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Button } from '@upskills/ui';
import { EmailSchema } from '@upskills/validation';

import { AuthService } from '../../auth/auth-service';
import { guestGuard } from '../../auth/guest-guard';
import {
  POST_AUTH_LANDING,
  safeRedirectTarget,
  signInErrorMessage,
  type SignInFlow,
} from '../../auth/sign-in-errors';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

type LoginState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string };

export const routeMeta: RouteMeta = {
  canActivate: [guestGuard],
};

function emailValidator(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') {
    return { email: true };
  }

  return EmailSchema.safeParse(control.value).success ? null : { email: true };
}

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    Button,
    LandingHeaderComponent,
    LandingFooterComponent,
  ],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto w-full max-w-md">
        <div
          class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-indigo-950/5 sm:p-8"
        >
          <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
            Sign in
          </h1>
          <p class="mt-2 text-sm text-zinc-600">
            Continue to your organizer or admin workspace.
          </p>

          <div class="mt-6">
            <ui-button
              class="w-full"
              type="button"
              variant="secondary"
              size="lg"
              [disabled]="status() === 'submitting'"
              (click)="continueWithGoogle()"
            >
              Continue with Google
            </ui-button>
          </div>

          <div
            class="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-zinc-400"
          >
            <span class="h-px flex-1 bg-zinc-200" aria-hidden="true"></span>
            or
            <span class="h-px flex-1 bg-zinc-200" aria-hidden="true"></span>
          </div>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="flex flex-col gap-4">
              <div>
                <label
                  class="block text-sm font-medium text-zinc-700"
                  for="login-email"
                >
                  Email address
                </label>
                <input
                  id="login-email"
                  type="email"
                  formControlName="email"
                  autocomplete="email"
                  placeholder="you@example.com"
                  [attr.aria-invalid]="invalid('email') ? 'true' : null"
                  class="mt-1.5 h-11 w-full rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div>
                <label
                  class="block text-sm font-medium text-zinc-700"
                  for="login-password"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  formControlName="password"
                  autocomplete="current-password"
                  placeholder="Your password"
                  [attr.aria-invalid]="invalid('password') ? 'true' : null"
                  class="mt-1.5 h-11 w-full rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <ui-button
                class="w-full"
                type="submit"
                size="lg"
                [disabled]="status() === 'submitting' || form.invalid"
              >
                @if (status() === 'submitting') {
                  Signing in…
                } @else {
                  Sign in
                }
              </ui-button>
            </div>

            <div class="mt-4 min-h-5 text-sm" aria-live="polite">
              @if (status() === 'error') {
                <p class="text-red-600" role="alert">{{ message() }}</p>
              }
            </div>
          </form>

          <p class="mt-6 text-center text-sm text-zinc-600">
            New here?
            <a
              [routerLink]="['/auth/register']"
              [queryParams]="linkQueryParams()"
              class="font-medium text-indigo-600 transition-colors hover:text-indigo-500"
            >
              Create an account
            </a>
          </p>
        </div>
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class LoginPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly state = signal<LoginState>({ status: 'idle' });

  readonly form = new FormGroup({
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: emailValidator,
    }),
    password: new FormControl<string>('', {
      nonNullable: true,
      validators: Validators.required,
    }),
  });

  readonly status = computed(() => this.state().status);
  readonly message = computed(() => {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  });

  private readonly redirectTo: string;

  constructor() {
    // The fallback is the dashboard, not `/`: somebody who opened this page
    // came here to reach their workspace, and the landing page is written for
    // visitors who are not signed in.
    this.redirectTo = safeRedirectTarget(
      this.route.snapshot.queryParamMap.get('redirectTo'),
      POST_AUTH_LANDING,
    );
  }

  ngOnInit(): void {
    this.title.setTitle('Sign in · Upskills');
  }

  /** Whether a control should be flagged to assistive tech as invalid. */
  invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && field.touched;
  }

  linkQueryParams(): { redirectTo?: string } {
    return this.redirectTo === POST_AUTH_LANDING
      ? {}
      : { redirectTo: this.redirectTo };
  }

  async continueWithGoogle(): Promise<void> {
    await this.signIn(() => this.auth.loginWithGoogle(), 'google');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const parsedEmail = EmailSchema.safeParse(this.form.controls.email.value);

    if (!parsedEmail.success) {
      this.form.markAllAsTouched();
      return;
    }

    await this.signIn(
      () =>
        this.auth.loginWithEmail(
          parsedEmail.data,
          this.form.controls.password.value,
        ),
      'password',
    );
  }

  private async signIn(
    action: () => Promise<unknown>,
    flow: SignInFlow,
  ): Promise<void> {
    this.state.set({ status: 'submitting' });

    try {
      await action();
    } catch (error) {
      const message = signInErrorMessage(error, flow);
      this.state.set(
        message === null ? { status: 'idle' } : { status: 'error', message },
      );
      return;
    }

    await this.router.navigateByUrl(this.redirectTo);
  }
}
