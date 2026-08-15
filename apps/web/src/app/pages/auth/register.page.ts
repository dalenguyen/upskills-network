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
import {
  safeRedirectTarget,
  signInErrorMessage,
} from '../../auth/sign-in-errors';
import { LandingFooterComponent } from '../../landing/landing-footer.component';
import { LandingHeaderComponent } from '../../landing/landing-header.component';

type RegisterState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string };

function emailValidator(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') {
    return { email: true };
  }

  return EmailSchema.safeParse(control.value).success ? null : { email: true };
}

@Component({
  selector: 'app-register-page',
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
            Create your account
          </h1>
          <p class="mt-2 text-sm text-zinc-600">
            Start organizing workshops or manage one your team already runs.
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
                  for="register-email"
                >
                  Email address
                </label>
                <input
                  id="register-email"
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
                  for="register-password"
                >
                  Password
                </label>
                <input
                  id="register-password"
                  type="password"
                  formControlName="password"
                  autocomplete="new-password"
                  placeholder="At least 6 characters"
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
                  Creating account…
                } @else {
                  Create account
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
            Already have an account?
            <a
              [routerLink]="['/auth/login']"
              [queryParams]="linkQueryParams()"
              class="font-medium text-indigo-600 transition-colors hover:text-indigo-500"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class RegisterPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly state = signal<RegisterState>({ status: 'idle' });

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
    this.redirectTo = safeRedirectTarget(
      this.route.snapshot.queryParamMap.get('redirectTo'),
    );
  }

  ngOnInit(): void {
    this.title.setTitle('Create your account · Upskills');
  }

  /** Whether a control should be flagged to assistive tech as invalid. */
  invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && field.touched;
  }

  linkQueryParams(): { redirectTo?: string } {
    return this.redirectTo === '/' ? {} : { redirectTo: this.redirectTo };
  }

  async continueWithGoogle(): Promise<void> {
    await this.signIn(() => this.auth.loginWithGoogle());
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

    await this.signIn(() =>
      this.auth.registerWithEmail(
        parsedEmail.data,
        this.form.controls.password.value,
      ),
    );
  }

  private async signIn(action: () => Promise<unknown>): Promise<void> {
    this.state.set({ status: 'submitting' });

    try {
      await action();
    } catch (error) {
      const message = signInErrorMessage(error);
      this.state.set(
        message === null ? { status: 'idle' } : { status: 'error', message },
      );
      return;
    }

    await this.router.navigateByUrl(this.redirectTo);
  }
}
