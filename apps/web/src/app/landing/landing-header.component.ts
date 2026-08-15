import { Component } from '@angular/core';

import { Button } from '@upskills/ui';

@Component({
  selector: 'app-landing-header',
  imports: [Button],
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
        <ui-button href="#waitlist">Join the waitlist</ui-button>
      </div>
    </header>
  `,
})
export class LandingHeaderComponent {}
