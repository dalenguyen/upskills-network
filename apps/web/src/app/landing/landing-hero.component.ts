import { Component } from '@angular/core';

import { Badge, Icon, Section } from '@upskills/ui';

import { LandingWaitlistFormComponent } from './landing-waitlist-form.component';

@Component({
  selector: 'app-landing-hero',
  imports: [Section, Badge, Icon, LandingWaitlistFormComponent],
  template: `
    <div class="relative isolate overflow-hidden">
      <!-- Tinted backdrop: a vertical wash plus an indigo glow behind the
           headline, so the hero reads as a distinct band from the white
           sections below it. -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50 via-indigo-50/30 to-white"
      ></div>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-[-20rem] -z-10 h-[40rem] w-[64rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(129,140,248,0.35),transparent)] blur-3xl"
      ></div>

      <ui-section width="narrow" spacing="default">
        <div class="flex flex-col items-center gap-6 text-center">
          <ui-badge>
            <span
              class="h-1.5 w-1.5 rounded-full bg-indigo-500"
              aria-hidden="true"
            ></span>
            Now taking signups for the first cohort
          </ui-badge>

          <!-- The accent half is a block so the headline always breaks between
               the two sentences. Left inline, text-balance splits it
               mid-sentence on narrow viewports and the colour change lands in
               the middle of a line. -->
          <h1
            class="text-4xl font-bold leading-[1.1] tracking-tight text-zinc-900 sm:text-5xl lg:text-6xl"
          >
            Grow your skills.
            <span class="block text-indigo-600">Expand your network.</span>
          </h1>

          <p class="max-w-2xl text-pretty text-lg leading-8 text-zinc-600">
            Upskills hosts in-person workshops where professionals learn from
            practitioners and meet peers — no lectures, no passive webinars.
          </p>

          <app-landing-waitlist-form />

          <ul
            class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500"
          >
            @for (proof of proofPoints; track proof) {
              <li class="flex items-center gap-1.5">
                <ui-icon name="check" size="sm" class="text-indigo-500" />
                {{ proof }}
              </li>
            }
          </ul>
        </div>
      </ui-section>
    </div>
  `,
})
export class LandingHeroComponent {
  readonly proofPoints: readonly string[] = [
    'Small groups',
    'Free while in beta',
    'Hands-on, every session',
  ];
}
