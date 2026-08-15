import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Button, Icon } from '@upskills/ui';
import { EmailSchema } from '@upskills/validation';

export const WAITLIST_ENDPOINT = '/api/v1/waitlist';

type WaitlistStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'already-subscribed'
  | 'inline-error';

type WaitlistFormState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'already-subscribed' }
  | { status: 'inline-error'; message: string };

interface WaitlistApiResponse {
  status: 'subscribed' | 'already_subscribed';
}

const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
const GENERIC_ERROR_MESSAGE =
  "We couldn't join you to the waitlist. Please try again.";

function emailValidator(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') {
    return { email: true };
  }

  return EmailSchema.safeParse(control.value).success ? null : { email: true };
}

@Component({
  selector: 'app-landing-waitlist-form',
  imports: [ReactiveFormsModule, Button, Icon],
  template: `
    <form
      id="waitlist"
      class="mx-auto flex w-full max-w-md flex-col gap-3"
      [formGroup]="form"
      (ngSubmit)="submit()"
      novalidate
    >
      <label class="sr-only" for="waitlist-email">Email address</label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <input
          id="waitlist-email"
          type="email"
          formControlName="email"
          autocomplete="email"
          placeholder="you@example.com"
          [attr.aria-invalid]="
            form.controls.email.invalid && form.controls.email.touched
              ? 'true'
              : null
          "
          class="h-11 w-full rounded-md border border-zinc-300 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <ui-button type="submit" [disabled]="status() === 'loading'">
          @if (status() === 'loading') {
            Joining…
          } @else {
            Join the waitlist
          }
        </ui-button>
      </div>

      @if (status() === 'inline-error') {
        <p class="text-sm text-red-600" role="alert">{{ errorMessage() }}</p>
      } @else if (status() === 'success') {
        <p
          class="flex items-center justify-center gap-2 text-sm font-medium text-emerald-700"
          role="status"
        >
          <ui-icon name="check" />
          You're on the list. We'll be in touch.
        </p>
      } @else if (status() === 'already-subscribed') {
        <p class="text-sm font-medium text-indigo-700" role="status">
          You're already on the list.
        </p>
      }
    </form>
  `,
})
export class LandingWaitlistFormComponent {
  private readonly http = inject(HttpClient);
  private readonly state = signal<WaitlistFormState>({ status: 'idle' });

  readonly form = new FormGroup({
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: emailValidator,
    }),
  });

  readonly status = computed<WaitlistStatus>(() => this.state().status);
  readonly errorMessage = computed(() =>
    this.state().status === 'inline-error' ? this.state().message : '',
  );

  async submit(): Promise<void> {
    const rawEmail = this.form.controls.email.value;
    const parsedEmail = EmailSchema.safeParse(rawEmail);

    if (!parsedEmail.success) {
      this.form.controls.email.markAsTouched();
      this.state.set({ status: 'inline-error', message: INVALID_EMAIL_MESSAGE });
      return;
    }

    this.state.set({ status: 'loading' });

    try {
      const response = await firstValueFrom(
        this.http.post<WaitlistApiResponse>(WAITLIST_ENDPOINT, {
          email: parsedEmail.data,
        }),
      );

      if (response.status === 'already_subscribed') {
        this.state.set({ status: 'already-subscribed' });
        return;
      }

      this.form.reset();
      this.state.set({ status: 'success' });
    } catch (error) {
      this.state.set({
        status: 'inline-error',
        message: waitlistErrorMessage(error),
      });
    }
  }
}

function waitlistErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 400) {
    return INVALID_EMAIL_MESSAGE;
  }

  return GENERIC_ERROR_MESSAGE;
}
