import { Component, input } from '@angular/core';

/**
 * A visible loading indicator for full-page `@case ('loading')` states.
 *
 * Plain text ("Loading…") is easy to miss against the page background and
 * reads as a blank page for the instant it's on screen. This pairs a spinner
 * with the label so a slow request is visibly "in progress" rather than
 * looking broken.
 */
@Component({
  selector: 'app-loading-state',
  template: `
    <div class="flex items-center justify-center gap-3 py-12" role="status">
      <svg
        class="h-5 w-5 animate-spin text-indigo-600"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
        ></circle>
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        ></path>
      </svg>
      <p class="text-sm text-zinc-500">{{ label() }}</p>
    </div>
  `,
})
export class LoadingStateComponent {
  readonly label = input.required<string>();
}
