import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Button, Icon } from '@upskills/ui';
import { EmailSchema, RegisterGuestSchema } from '@upskills/validation';

import {
  apiErrorCode,
  apiErrorStatus,
  registerEndpoint,
  type PublicEvent,
  type RegisterResponse,
} from './event-api';

export { registerEndpoint };

/**
 * The registration form, and every state it can end in.
 *
 * ## Registering twice is not a failure
 *
 * `POST .../register` answers 200 with `alreadyRegistered: true` for a
 * double-submitted form, a reloaded tab, or a guest who genuinely forgot. The
 * form says so plainly. Showing an error there would tell someone who *is*
 * registered that they are not, which is the one wrong answer available.
 *
 * ## A sold-out event still takes the form
 *
 * When capacity is gone the API waitlists the registration rather than refusing
 * it, so the form stays enabled and the copy changes: the heading says the
 * workshop is full, and the button says "Join the waitlist". A disabled button
 * with no explanation would hide a path the guest actually has.
 *
 * The distinction survives into the result — a waitlisted guest is told they
 * are on the waitlist and given their position, never "you're registered".
 *
 * ## Paid events have no path yet
 *
 * `reserveSpot` refuses a paid event with 409 `payment-required` until the
 * Stripe hold lands (#47/#50). Rather than render a form whose only possible
 * outcome is that error, a paid event gets a panel that says registration is
 * not open yet. When checkout exists, this branch is what it replaces — along
 * with the refund-policy notice that must appear before any redirect.
 */

type RegistrationStatus =
  | 'idle'
  | 'loading'
  | 'confirmed'
  | 'waitlisted'
  | 'already-registered'
  | 'inline-error';

type RegistrationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'confirmed'; emailSent: boolean }
  | { status: 'waitlisted'; position: number; emailSent: boolean }
  | {
      status: 'already-registered';
      outcome: RegisterResponse['status'];
      position: number | null;
    }
  | { status: 'inline-error'; message: string };

const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
const MISSING_NAME_MESSAGE = 'Enter the name to put on the guest list.';
const GENERIC_ERROR_MESSAGE =
  "We couldn't complete your registration. Please try again.";

/** Error codes the API produces that are worth their own sentence. */
const ERROR_MESSAGES: Record<string, string> = {
  'event-cancelled': 'This workshop has been cancelled.',
  'event-not-found': 'This workshop is no longer available.',
  'payment-required':
    'This is a paid workshop, and payment is not open yet. Contact the organizer to hold a spot.',
  'invalid-registration': 'Enter a valid email address and a name.',
};

function emailValidator(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') {
    return { email: true };
  }

  return EmailSchema.safeParse(control.value).success ? null : { email: true };
}

function nameValidator(control: AbstractControl): ValidationErrors | null {
  return RegisterGuestSchema.shape.name.safeParse(control.value).success
    ? null
    : { name: true };
}

@Component({
  selector: 'app-registration-form',
  imports: [ReactiveFormsModule, Button, Icon],
  template: `
    <div
      id="register"
      class="scroll-mt-24 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-indigo-950/5 sm:p-8"
    >
      @if (event().price > 0) {
        <h2 class="text-lg font-bold tracking-tight text-zinc-900">
          Registration is not open yet
        </h2>
        <p class="mt-2 text-sm text-zinc-600">
          This is a paid workshop, and online payment is not open yet. Contact
          the organizer if you'd like a spot held.
        </p>
      } @else {
        <h2 class="text-lg font-bold tracking-tight text-zinc-900">
          @if (event().soldOut) {
            This workshop is full
          } @else {
            Save your spot
          }
        </h2>

        <p class="mt-2 text-sm text-zinc-600">
          @if (event().soldOut) {
            Join the waitlist and we'll email you the moment a spot opens up.
          } @else {
            Free to attend. We'll email your confirmation and a link to cancel
            if your plans change.
          }
        </p>

        <form class="mt-6" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="flex flex-col gap-4">
            <div>
              <label
                class="block text-sm font-medium text-zinc-700"
                for="registration-name"
              >
                Full name
              </label>
              <input
                id="registration-name"
                type="text"
                formControlName="name"
                autocomplete="name"
                placeholder="Ada Lovelace"
                [attr.aria-invalid]="invalid('name') ? 'true' : null"
                class="mt-1.5 h-11 w-full rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <label
                class="block text-sm font-medium text-zinc-700"
                for="registration-email"
              >
                Email address
              </label>
              <input
                id="registration-email"
                type="email"
                formControlName="email"
                autocomplete="email"
                placeholder="you@example.com"
                [attr.aria-invalid]="invalid('email') ? 'true' : null"
                class="mt-1.5 h-11 w-full rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <ui-button
              class="w-full"
              type="submit"
              size="lg"
              [disabled]="status() === 'loading'"
            >
              @if (status() === 'loading') {
                Submitting…
              } @else if (event().soldOut) {
                Join the waitlist
              } @else {
                Register free
              }
            </ui-button>
          </div>

          <div class="mt-4 min-h-5 text-sm">
            @switch (status()) {
              @case ('inline-error') {
                <p class="text-red-600" role="alert">{{ message() }}</p>
              }
              @case ('confirmed') {
                <p
                  class="flex items-start gap-2 font-medium text-emerald-700"
                  role="status"
                >
                  <ui-icon name="check" size="sm" />
                  <span>You're registered. {{ message() }}</span>
                </p>
              }
              @case ('waitlisted') {
                <p class="font-medium text-indigo-700" role="status">
                  You're on the waitlist. {{ message() }}
                </p>
              }
              @case ('already-registered') {
                <p class="font-medium text-indigo-700" role="status">
                  You're already registered. {{ message() }}
                </p>
              }
            }
          </div>
        </form>
      }
    </div>
  `,
})
export class RegistrationFormComponent {
  private readonly http = inject(HttpClient);
  private readonly state = signal<RegistrationState>({ status: 'idle' });

  readonly event = input.required<PublicEvent>();

  readonly form = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: nameValidator,
    }),
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: emailValidator,
    }),
  });

  readonly status = computed<RegistrationStatus>(() => this.state().status);
  readonly message = computed(() => messageFor(this.state()));

  /** Whether a control should be flagged to assistive tech as invalid. */
  invalid(control: 'name' | 'email'): boolean {
    const field = this.form.controls[control];
    return field.invalid && field.touched;
  }

  async submit(): Promise<void> {
    const parsed = RegisterGuestSchema.safeParse(this.form.getRawValue());

    if (!parsed.success) {
      this.form.markAllAsTouched();
      this.state.set({
        status: 'inline-error',
        // The email is checked first because it is the field a guest is most
        // likely to fumble, and reporting one problem at a time keeps the
        // single message line honest.
        message: this.form.controls.email.invalid
          ? INVALID_EMAIL_MESSAGE
          : MISSING_NAME_MESSAGE,
      });
      return;
    }

    this.state.set({ status: 'loading' });

    try {
      const response = await firstValueFrom(
        this.http.post<RegisterResponse>(
          registerEndpoint(this.event().orgId, this.event().eventId),
          { email: parsed.data.email, name: parsed.data.name },
        ),
      );

      this.state.set(stateFor(response));

      if (!response.alreadyRegistered) {
        this.form.reset();
      }
    } catch (error) {
      this.state.set({ status: 'inline-error', message: errorMessage(error) });
    }
  }
}

function stateFor(response: RegisterResponse): RegistrationState {
  if (response.alreadyRegistered) {
    return {
      status: 'already-registered',
      outcome: response.status,
      position: response.waitlistPosition ?? null,
    };
  }

  return response.status === 'waitlisted'
    ? {
        status: 'waitlisted',
        position: response.waitlistPosition ?? 0,
        emailSent: response.emailSent,
      }
    : { status: 'confirmed', emailSent: response.emailSent };
}

/**
 * The sentence that follows the headline of each result state.
 *
 * A failed confirmation email is called out rather than glossed over: the
 * cancel link only ever travels by email, so a guest without it cannot release
 * their own spot and needs to know to ask the organizer.
 */
function messageFor(state: RegistrationState): string {
  switch (state.status) {
    case 'inline-error':
      return state.message;

    case 'confirmed':
      return state.emailSent
        ? 'Check your email for the confirmation and your cancellation link.'
        : "We couldn't send your confirmation email — you're still registered, but contact the organizer if you need to cancel.";

    case 'waitlisted':
      return state.emailSent
        ? `You're number ${state.position} in line, and we'll email you if a spot opens.`
        : `You're number ${state.position} in line. We couldn't send your confirmation email — contact the organizer if you need to cancel.`;

    case 'already-registered':
      if (state.outcome === 'waitlisted') {
        return state.position === null
          ? "You're already on the waitlist for this workshop."
          : `You're already on the waitlist, at number ${state.position}.`;
      }

      return 'Your original confirmation email has the cancellation link.';

    default:
      return '';
  }
}

/**
 * Read structurally rather than by class: the same failure arrives as an
 * `HttpErrorResponse` in the browser and as an ofetch `FetchError` under
 * production SSR. See `event-api.ts`.
 */
function errorMessage(error: unknown): string {
  const code = apiErrorCode(error);

  if (code !== null && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code];
  }

  return apiErrorStatus(error) === 404
    ? ERROR_MESSAGES['event-not-found']
    : GENERIC_ERROR_MESSAGE;
}
