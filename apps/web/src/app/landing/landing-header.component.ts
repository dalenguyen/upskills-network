import { Component } from '@angular/core';

@Component({
  selector: 'app-landing-header',
  imports: [],
  template: `
    <header
      class="sticky top-0 z-40 border-b border-zinc-900/5 bg-white/75 backdrop-blur-md"
    >
      <div
        class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8"
      >
        <a href="/" class="flex items-center gap-2.5">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30"
            aria-hidden="true"
          >
            U
          </span>
          <span class="text-lg font-bold tracking-tight text-zinc-900">
            Upskills
          </span>
        </a>

        <nav
          class="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex"
          aria-label="Primary"
        >
          <a
            href="/#how-it-works"
            class="transition-colors hover:text-zinc-900"
          >
            How it works
          </a>
          <a href="/#features" class="transition-colors hover:text-zinc-900">
            Why Upskills
          </a>
        </nav>

        <a
          href="/#waitlist"
          class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition duration-150 hover:bg-indigo-500 hover:shadow-md hover:shadow-indigo-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Join the waitlist
        </a>
      </div>
    </header>
  `,
})
export class LandingHeaderComponent {}
