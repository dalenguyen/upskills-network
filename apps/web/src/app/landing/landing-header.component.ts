import { Component } from '@angular/core';

@Component({
  selector: 'app-landing-header',
  imports: [],
  template: `
    <header
      class="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur"
    >
      <div
        class="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"
      >
        <a href="/" class="text-xl font-bold tracking-tight text-zinc-900">
          Upskills
        </a>
        <a
          href="#waitlist"
          class="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Join the waitlist
        </a>
      </div>
    </header>
  `,
})
export class LandingHeaderComponent {}
