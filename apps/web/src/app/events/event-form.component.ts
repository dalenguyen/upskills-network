import { HttpClient } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HeroImage } from '@upskills/models';
import { nextSlugCandidate, slugify } from '@upskills/validation';
import { firstValueFrom } from 'rxjs';

import {
  dashboardEventCreateEndpoint,
  dashboardEventImageUploadEndpoint,
  dashboardEventUpdateEndpoint,
  type DashboardEvent,
  type DashboardEventsCreateResponse,
  type DashboardEventsUpdateResponse,
} from '../dashboard/dashboard-api';
import { apiErrorStatus } from './event-api';
import {
  CANADIAN_TIME_ZONES,
  centsToDollars,
  dollarsToCents,
  heroImageFileError,
  heroImageUploadErrorMessage,
  imageUrlError,
  toIsoWithOffset,
  toLocalDatetimeValue,
} from './event-form-helpers';

/**
 * How many slugs to try before giving up and reporting the collision.
 *
 * Small on purpose. This exists to absorb "two events with the same obvious
 * name", which is one or two retries in practice; a page that quietly tried
 * fifty would be papering over a naming problem the organizer should see.
 */
const MAX_SLUG_ATTEMPTS = 5;

interface EventForm {
  title: string;
  slug: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string;
  /** Absolute https URL of a hero image. Empty means the event has none. */
  imageUrl: string;
  /** Entered in dollars, e.g. `49.50`. Converted to cents before posting. */
  price: string;
  maxGuests: string;
}

/**
 * The event create/edit form, shared by the organizer dashboard and the
 * platform-admin console.
 *
 * One component for both modes rather than two near-identical forms: the two
 * pages differed only in POST vs PUT and in whether the slug was derived from
 * the title, and every field, label, and validation rule was copied. {@link
 * event} decides the mode — `null` creates, an event edits it.
 *
 * It talks to the dashboard routes in both places. A platform admin passes
 * `requireOrgRole` for any org, so the admin console needs no routes of its
 * own.
 */
@Component({
  selector: 'app-event-form',
  imports: [FormsModule],
  template: `
    <form class="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label
          for="title"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxlength="200"
          [(ngModel)]="form.title"
          (ngModelChange)="onTitleChange()"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
      </div>

      <div>
        <label
          for="slug"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          pattern="[a-z0-9-]+"
          [(ngModel)]="form.slug"
          (ngModelChange)="slugTouched = true"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
        <p class="mt-1 text-xs text-zinc-500">
          Lowercase letters, numbers, and hyphens only. Filled in from the title
          until you edit it.
        </p>
      </div>

      <div>
        <label
          for="timezone"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Timezone
        </label>
        <select
          id="timezone"
          name="timezone"
          required
          [(ngModel)]="form.timezone"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        >
          @for (zone of timezones; track zone) {
            <option [value]="zone">{{ zone }}</option>
          }
        </select>
      </div>

      <div class="sm:col-span-2">
        <label
          for="description"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows="4"
          maxlength="5000"
          [(ngModel)]="form.description"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        ></textarea>
      </div>

      <div>
        <label
          for="startsAt"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Starts at
        </label>
        <input
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          required
          [(ngModel)]="form.startsAt"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
      </div>

      <div>
        <label
          for="endsAt"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Ends at
        </label>
        <input
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          [(ngModel)]="form.endsAt"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
      </div>

      <div>
        <label
          for="location"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Location
        </label>
        <input
          id="location"
          name="location"
          type="text"
          maxlength="300"
          [(ngModel)]="form.location"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
      </div>

      <div>
        <label
          [attr.for]="
            heroImageMode() === 'upload' ? 'heroImageFile' : 'imageUrl'
          "
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Event image
        </label>

        @if (heroImageMode() === 'upload') {
          <input
            id="heroImageFile"
            name="heroImageFile"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            [disabled]="uploadingImage()"
            (change)="onHeroImageSelected($event)"
            class="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
          />
          <p class="mt-2 text-xs text-zinc-500">
            Optional. JPEG, PNG or WebP, up to 5 MB. Uploads as soon as you
            choose it.
          </p>

          @if (uploadingImage()) {
            <p
              role="status"
              class="mt-2 flex items-center gap-2 text-xs text-zinc-600"
            >
              <span
                aria-hidden="true"
                class="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600"
              ></span>
              Uploading your image…
            </p>
          }
        } @else {
          <input
            id="imageUrl"
            name="imageUrl"
            type="url"
            maxlength="2000"
            placeholder="https://example.com/poster.jpg"
            [value]="form.imageUrl"
            (input)="onImageUrlInput($event)"
            class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
          />
          <p class="mt-2 text-xs text-zinc-500">
            @if (isEdit()) {
              Optional. Must start with https://. Clear the field to remove the
              image.
            } @else {
              Optional. Must start with https://. Link an image you host — if it
              stops loading, the event simply shows without one.
            }
          </p>
        }

        @if (imageUploadError(); as message) {
          <p role="alert" class="mt-2 text-sm text-red-600">{{ message }}</p>
        }

        @if (form.imageUrl !== '' && !uploadingImage()) {
          <div class="mt-3 flex items-start gap-3">
            <img
              [src]="form.imageUrl"
              alt=""
              referrerpolicy="no-referrer"
              class="h-20 w-32 rounded-lg object-cover ring-1 ring-zinc-200"
            />
            <button
              type="button"
              (click)="removeHeroImage()"
              class="text-sm font-medium text-zinc-600 underline hover:text-zinc-900"
            >
              Remove image
            </button>
          </div>
        }

        <button
          type="button"
          (click)="toggleHeroImageMode()"
          class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          @if (heroImageMode() === 'upload') {
            or use a link
          } @else {
            or upload a file
          }
        </button>
      </div>

      <div>
        <label
          for="price"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Price (CAD)
        </label>
        <input
          id="price"
          name="price"
          type="number"
          required
          min="0"
          step="0.01"
          [(ngModel)]="form.price"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
        @if (hasPriceWarning()) {
          <p
            class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
          >
            Payments aren't live yet — guests won't be able to pay, so
            registration for this event will be refused until it's free.
          </p>
        }
      </div>

      <div>
        <label
          for="maxGuests"
          class="block text-sm font-medium leading-6 text-zinc-900"
        >
          Max guests
        </label>
        <input
          id="maxGuests"
          name="maxGuests"
          type="number"
          required
          min="0"
          step="1"
          [(ngModel)]="form.maxGuests"
          class="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
        <p class="mt-1 text-xs text-zinc-500">
          Enter 0 for an unlimited event.
        </p>
      </div>

      @if (submitError(); as message) {
        <div class="sm:col-span-2" role="alert">
          <p
            class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200"
          >
            {{ message }}
          </p>
        </div>
      }

      <div
        class="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end"
      >
        @if (showCancel()) {
          <button
            type="button"
            [disabled]="submitting()"
            (click)="cancelled.emit()"
            class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        }
        <button
          type="button"
          [disabled]="submitting()"
          (click)="submit('draft')"
          class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save as draft
        </button>
        <button
          type="button"
          [disabled]="submitting()"
          (click)="submit('published')"
          class="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Publish
        </button>
      </div>
    </form>
  `,
})
export class EventFormComponent {
  private readonly http = inject(HttpClient);

  /** The org the event belongs to. */
  readonly orgId = input.required<string>();

  /** The event being edited, or `null` to create a new one. */
  readonly event = input<DashboardEvent | null>(null);

  /** Whether to offer a Cancel button. Inline hosts want one; pages navigate. */
  readonly showCancel = input(false);

  /** The event as the server saved it. */
  readonly saved = output<DashboardEvent>();

  /** The Cancel button was pressed. Nothing was written. */
  readonly cancelled = output<void>();

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  /**
   * Which way the organizer is giving us a hero image.
   *
   * Uploading is the default; the URL field it replaced is still reachable
   * behind the "or use a link" toggle, because organizers hosting images on
   * their own CDN were doing that before uploads existed and nothing should
   * take it away from them.
   */
  private readonly chosenImageMode = signal<'upload' | 'link'>('upload');

  /**
   * Which input is showing, in both modes.
   *
   * Editing used to force the link field, because replacing an uploaded image
   * needs the superseded object deleted once the new URL is stored and nothing
   * did that yet. The update route does it now, so an organizer can swap the
   * file on a saved event exactly as they can on a new one.
   *
   * An edit still *opens* on whichever input matches what the event already
   * has — see {@link populate}. Someone who pasted a link should find that
   * link on screen, not a file picker that hides it.
   */
  readonly heroImageMode = computed<'upload' | 'link'>(() =>
    this.chosenImageMode(),
  );

  /** An upload is in flight. Blocks a second one and shows progress. */
  readonly uploadingImage = signal(false);

  /** Why the last upload or file choice failed. Cleared on the next attempt. */
  readonly imageUploadError = signal<string | null>(null);

  /**
   * Storage bookkeeping for an uploaded image, or `null` when the current
   * `form.imageUrl` is a pasted link (or empty).
   *
   * Held beside `form.imageUrl` rather than inside it because `imageUrl`
   * remains the single source of truth for rendering — this only records where
   * the bytes came from, and the two are posted together or not at all.
   */
  readonly heroImage = signal<HeroImage | null>(null);

  readonly timezones = CANADIAN_TIME_ZONES;

  /**
   * Whether the organizer has taken the slug over from the title.
   *
   * Plain field rather than a signal: nothing renders from it, it only gates
   * {@link onTitleChange} and the retry loop.
   */
  protected slugTouched = false;

  readonly form: EventForm = {
    title: '',
    slug: '',
    description: '',
    startsAt: '',
    endsAt: '',
    timezone: 'America/Toronto',
    location: '',
    imageUrl: '',
    price: '0',
    maxGuests: '0',
  };

  constructor() {
    effect(() => {
      const workshop = this.event();

      if (workshop !== null) {
        this.prefill(workshop);
      }
    });
  }

  isEdit(): boolean {
    return this.event() !== null;
  }

  /** Payments aren't wired up — a priced event can be saved but not paid for. */
  protected hasPriceWarning(): boolean {
    return Number(this.form.price) > 0;
  }

  private prefill(workshop: DashboardEvent): void {
    this.form.title = workshop.title;
    this.form.slug = workshop.slug;
    this.form.description = workshop.description;
    this.form.startsAt = toLocalDatetimeValue(
      workshop.startsAt,
      workshop.timezone,
    );
    this.form.endsAt =
      workshop.endsAt === undefined
        ? ''
        : toLocalDatetimeValue(workshop.endsAt, workshop.timezone);
    this.form.timezone = workshop.timezone;
    this.form.location = workshop.location ?? '';
    this.form.imageUrl = workshop.imageUrl ?? '';
    // Open on the input that matches what is already there: an event carrying
    // an image shows that image's URL, and one with no image gets the file
    // picker. Either way the toggle is right there to switch.
    this.chosenImageMode.set(
      (workshop.imageUrl ?? '') === '' ? 'upload' : 'link',
    );
    // Null rather than the stored bookkeeping, because this signal means
    // "bytes uploaded during *this* edit". Leaving the save untouched sends no
    // `heroImage`, and an unchanged `imageUrl` tells the write path to keep the
    // bookkeeping it already holds.
    this.heroImage.set(null);
    this.form.price = centsToDollars(workshop.price);
    this.form.maxGuests = String(workshop.maxGuests);

    // A slug that still matches its title was derived from it, so keep
    // deriving. One that does not was chosen by hand — renaming the event must
    // not silently move a URL somebody picked.
    this.slugTouched = workshop.slug !== slugify(workshop.title);
  }

  /**
   * Keep the slug in step with the title, until the organizer takes it over.
   *
   * Deriving it is the whole point — nobody wants to type `react-basics` after
   * typing `React Basics` — but silently rewriting a slug somebody has chosen
   * would be worse than not helping at all. {@link slugTouched} is the line
   * between the two, and it is one-way: once they edit the field, the title
   * stops driving it for the rest of the form's life.
   */
  protected onTitleChange(): void {
    if (!this.slugTouched) {
      this.form.slug = slugify(this.form.title);
    }
  }

  async submit(status: 'draft' | 'published'): Promise<void> {
    if (this.submitting()) {
      return;
    }

    // Both buttons are `type="button"`, so the native `required` never runs.
    // Without this the empty value reaches `toIsoWithOffset`, which throws a
    // RangeError on an invalid date and reports as a generic failure.
    if (this.form.startsAt.trim() === '') {
      this.submitError.set('Choose when the event starts.');
      return;
    }

    if (
      this.form.endsAt.trim() !== '' &&
      this.form.endsAt < this.form.startsAt
    ) {
      this.submitError.set('End time must be at or after the start time.');
      return;
    }

    const imageProblem = imageUrlError(this.form.imageUrl);
    if (imageProblem !== null) {
      this.submitError.set(imageProblem);
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const workshop = this.event();

      const result =
        workshop === null
          ? await this.postWithFreeSlug(status)
          : await this.put(workshop, status);

      this.saved.emit(result);
    } catch (error) {
      this.submitError.set(this.describeSubmitError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private async put(
    workshop: DashboardEvent,
    status: 'draft' | 'published',
  ): Promise<DashboardEvent> {
    const response = await firstValueFrom(
      this.http.put<DashboardEventsUpdateResponse>(
        dashboardEventUpdateEndpoint(workshop.orgId, workshop.eventId),
        this.buildBody(status, true),
        { withCredentials: true },
      ),
    );

    return response.event;
  }

  /**
   * POST the event, walking the slug forward while the server says it is taken.
   *
   * The server is the only authority on whether a slug is free — a check before
   * the write is a guess that goes stale — so this asks, and asks again with
   * `-2`, `-3` when the answer is 409. That turns the common case (two events
   * with the same obvious name, in the same org) from an error the organizer has
   * to resolve by hand into something they never see.
   *
   * The retries stop after {@link MAX_SLUG_ATTEMPTS}, and only ever on a 409:
   * any other failure is rethrown immediately rather than retried into a
   * different slug. The final 409 is rethrown too, so a genuinely stuck slug
   * still reports honestly instead of failing silently.
   *
   * A slug the organizer typed themselves is **not** walked forward. They asked
   * for that specific name; answering "taken" is the correct response, and
   * quietly filing their event under a different URL is not.
   */
  private async postWithFreeSlug(
    status: 'draft' | 'published',
  ): Promise<DashboardEvent> {
    const base = this.form.slug.trim();
    const attempts = this.slugTouched ? 1 : MAX_SLUG_ATTEMPTS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const slug = nextSlugCandidate(base, attempt);

      try {
        const response = await firstValueFrom(
          this.http.post<DashboardEventsCreateResponse>(
            dashboardEventCreateEndpoint(this.orgId()),
            { ...this.buildBody(status, false), slug },
            { withCredentials: true },
          ),
        );

        // Reflect what was actually taken, so a failure later in this session
        // does not show the organizer a slug their event does not have.
        this.form.slug = slug;
        return response.event;
      } catch (error) {
        if (attempt === attempts || apiErrorStatus(error) !== 409) {
          throw error;
        }
      }
    }

    // Unreachable: the loop returns or rethrows on its last attempt.
    throw new Error('slug walk ended without a result');
  }

  /**
   * Upload the chosen file straight away, rather than on save.
   *
   * Uploading on selection is what lets the URL land in the form and the
   * preview render while the form is still open. It also means the bytes are
   * already stored before the event exists, which is why the object path is
   * keyed by org and media id rather than by event id.
   *
   * The parameter is not called `event` on purpose: this component has an
   * `event` input, and shadowing it here has broken a run on this repo before.
   */
  async onHeroImageSelected(changeEvent: Event): Promise<void> {
    const input = changeEvent.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    const problem = heroImageFileError(file);
    if (problem !== null) {
      // Refused in the browser, so no request is made at all. The input is
      // cleared so choosing the same file again still fires a change event.
      this.imageUploadError.set(problem);
      input.value = '';
      return;
    }

    this.imageUploadError.set(null);
    this.uploadingImage.set(true);

    try {
      const body = new FormData();
      body.append('file', file);

      const uploaded = await firstValueFrom(
        this.http.post<{
          url: string;
          storagePath: string;
          contentType: string;
          sizeBytes: number;
        }>(dashboardEventImageUploadEndpoint(this.orgId()), body, {
          withCredentials: true,
        }),
      );

      this.form.imageUrl = uploaded.url;
      this.heroImage.set({
        storagePath: uploaded.storagePath,
        contentType: uploaded.contentType,
        sizeBytes: uploaded.sizeBytes,
        // Client-stamped: the upload route does not return a timestamp. Close
        // enough for bookkeeping, and never used to order anything.
        uploadedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Everything else in the form is untouched, so the organizer can retry,
      // choose a different file, or switch to a link without losing work.
      this.imageUploadError.set(
        heroImageUploadErrorMessage(apiErrorStatus(error)),
      );
    } finally {
      this.uploadingImage.set(false);
      input.value = '';
    }
  }

  /**
   * The URL field is one-way bound plus this handler, not `[(ngModel)]`.
   *
   * `form` is a plain object, and `ngModel` does not re-read one it did not
   * see change: assigning `form.imageUrl` after an upload would leave the
   * input showing the old value. That exact bug has shipped twice on this
   * repo. One-way `[value]` re-renders whenever the component does, so the
   * programmatic write after an upload is visible.
   */
  onImageUrlInput(inputEvent: Event): void {
    this.form.imageUrl = (inputEvent.target as HTMLInputElement).value;
    // A hand-typed URL is no longer described by the upload bookkeeping, and
    // the two must never disagree.
    this.heroImage.set(null);
    this.imageUploadError.set(null);
  }

  /** Clear the image entirely — both the URL and its bookkeeping. */
  removeHeroImage(): void {
    this.form.imageUrl = '';
    this.heroImage.set(null);
    this.imageUploadError.set(null);
  }

  /** Swap between uploading a file and pasting a link. */
  toggleHeroImageMode(): void {
    this.chosenImageMode.update((mode) =>
      mode === 'upload' ? 'link' : 'upload',
    );
    this.imageUploadError.set(null);
  }

  private buildBody(
    status: 'draft' | 'published',
    isEdit: boolean,
  ): Record<string, unknown> {
    const endsAt = this.form.endsAt.trim();
    const location = this.form.location.trim();
    const imageUrl = this.form.imageUrl.trim();
    const heroImage = this.heroImage();

    return {
      title: this.form.title.trim(),
      slug: this.form.slug.trim(),
      description: this.form.description.trim(),
      startsAt: toIsoWithOffset(this.form.startsAt, this.form.timezone),
      ...(endsAt === ''
        ? {}
        : { endsAt: toIsoWithOffset(endsAt, this.form.timezone) }),
      timezone: this.form.timezone,
      // On an edit both are always sent, empty string included, because
      // omitting a field there means "leave it as it was": an emptied input
      // that is then omitted silently keeps the old value — the field looks
      // cleared on screen and is not cleared in the database. The empty string
      // is what says "remove it", and `applyOptionalText` in `events-write.ts`
      // deletes the key rather than storing `''`.
      //
      // Creating is different, and correctly omits both: there is no previous
      // value for an absent field to preserve.
      ...(isEdit || location !== '' ? { location } : {}),
      ...(isEdit || imageUrl !== '' ? { imageUrl } : {}),
      // Bookkeeping travels with the URL it describes or not at all — both
      // schemas reject the pair split apart.
      //
      // Sent only when something was uploaded during this session. On an edit
      // that left the image alone it is absent, and because `imageUrl` then
      // arrives unchanged the write path keeps the bookkeeping already stored
      // — which is what stops an ordinary rename from orphaning a live image.
      ...(heroImage !== null && imageUrl !== '' ? { heroImage } : {}),
      price: dollarsToCents(Number(this.form.price)),
      currency: 'cad',
      maxGuests: Number(this.form.maxGuests),
      status,
    };
  }

  private describeSubmitError(error: unknown): string {
    const status = apiErrorStatus(error);
    const verb = this.isEdit() ? 'updated' : 'created';

    if (status === 409) {
      return 'That slug is already taken. Choose a different slug.';
    }

    if (status === 400) {
      return `The event could not be ${verb}. Check the form and try again.`;
    }

    return `Something went wrong while saving the event. Please try again.`;
  }
}
