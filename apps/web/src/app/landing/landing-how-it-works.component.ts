import { Component } from '@angular/core';

import { Icon, Section, type IconName } from '@upskills/ui';

interface Step {
  icon: IconName;
  title: string;
  description: string;
}

@Component({
  selector: 'app-landing-how-it-works',
  imports: [Section, Icon],
  template: `
    <ui-section id="how-it-works" spacing="compact">
      <div class="mx-auto max-w-2xl text-center">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-indigo-600"
        >
          How it works
        </p>
        <h2
          class="mt-3 text-balance text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
        >
          Three steps from signup to a room full of peers
        </h2>
      </div>

      <ol class="relative mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        <!-- Connector sits behind the step markers, inset so it spans between
             the first and last icon rather than the full grid width. -->
        <div
          aria-hidden="true"
          class="absolute left-[16.667%] right-[16.667%] top-7 hidden border-t border-dashed border-zinc-300 sm:block"
        ></div>

        @for (step of steps; track step.title; let index = $index) {
          <li class="relative flex flex-col gap-4 sm:items-center sm:text-center">
            <div
              class="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-zinc-200"
            >
              <ui-icon [name]="step.icon" size="lg" />
            </div>
            <div class="flex flex-col gap-1.5">
              <p
                class="text-xs font-semibold uppercase tracking-widest text-indigo-600"
              >
                Step {{ index + 1 }}
              </p>
              <h3 class="text-lg font-semibold text-zinc-900">
                {{ step.title }}
              </h3>
              <p class="text-pretty text-sm leading-6 text-zinc-600">
                {{ step.description }}
              </p>
            </div>
          </li>
        }
      </ol>
    </ui-section>
  `,
})
export class LandingHowItWorksComponent {
  readonly steps: readonly Step[] = [
    {
      icon: 'ticket',
      title: 'Join the waitlist',
      description:
        'Drop your email and we let you know the moment sessions open in your city.',
    },
    {
      icon: 'map-pin',
      title: 'Pick a workshop',
      description:
        'Browse upcoming sessions, see who is teaching, and reserve your spot in a click.',
    },
    {
      icon: 'users',
      title: 'Show up and connect',
      description:
        'Spend an evening building something real alongside people worth knowing.',
    },
  ];
}
