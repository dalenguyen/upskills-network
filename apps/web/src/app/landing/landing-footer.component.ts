import { Component } from '@angular/core';

import { Section } from '@upskills/ui';

@Component({
  selector: 'app-landing-footer',
  imports: [Section],
  template: `
    <footer class="bg-white">
      <ui-section spacing="compact">
        <div
          class="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-start sm:justify-between sm:text-left"
        >
          <div class="flex flex-col items-center gap-3 sm:items-start">
            <a href="/" class="flex items-center gap-2.5">
              <span
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white"
                aria-hidden="true"
              >
                U
              </span>
              <span class="text-base font-bold text-zinc-900">Upskills</span>
            </a>
            <p class="max-w-xs text-sm leading-6 text-zinc-500">
              In-person workshops where professionals learn from practitioners
              and meet peers.
            </p>
          </div>

          <nav
            class="flex flex-col items-center gap-3 text-sm text-zinc-600 sm:items-end"
            aria-label="Footer"
          >
            <a
              href="#how-it-works"
              class="transition-colors hover:text-zinc-900"
            >
              How it works
            </a>
            <a href="#features" class="transition-colors hover:text-zinc-900">
              Why Upskills
            </a>
            <a
              href="mailto:hello@upskills.com"
              class="font-medium text-indigo-600 transition-colors hover:text-indigo-500"
            >
              hello@upskills.com
            </a>
          </nav>
        </div>

        <div
          class="mt-10 border-t border-zinc-200 pt-6 text-center text-sm text-zinc-500"
        >
          <p>© 2026 Upskills</p>
        </div>
      </ui-section>
    </footer>
  `,
})
export class LandingFooterComponent {}
