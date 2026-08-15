import { Component } from '@angular/core';

import { Section } from '@upskills/ui';

@Component({
  selector: 'app-landing-footer',
  imports: [Section],
  template: `
    <footer class="border-t border-zinc-200 bg-zinc-50">
      <ui-section>
        <div
          class="flex flex-col items-center justify-between gap-4 text-sm text-zinc-600 sm:flex-row"
        >
          <a href="/" class="text-base font-bold text-zinc-900">Upskills</a>
          <p>© 2026 Upskills</p>
          <a
            href="mailto:hello@upskills.com"
            class="text-indigo-600 hover:text-indigo-500"
          >
            hello@upskills.com
          </a>
        </div>
      </ui-section>
    </footer>
  `,
})
export class LandingFooterComponent {}
