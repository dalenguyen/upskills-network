import { Component } from '@angular/core';

import { Section } from '@upskills/ui';

import { LandingWaitlistFormComponent } from './landing-waitlist-form.component';

@Component({
  selector: 'app-landing-hero',
  imports: [Section, LandingWaitlistFormComponent],
  template: `
    <ui-section>
      <div
        class="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center"
      >
        <h1
          class="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl lg:text-6xl"
        >
          Grow your skills. Expand your network.
        </h1>
        <p class="max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl">
          Upskills hosts in-person workshops where professionals learn from
          practitioners and meet peers — no lectures, no passive webinars.
        </p>
        <app-landing-waitlist-form />
      </div>
    </ui-section>
  `,
})
export class LandingHeroComponent {}
