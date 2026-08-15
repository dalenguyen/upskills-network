import { Component } from '@angular/core';

import { Card, Icon, Section, type IconName } from '@upskills/ui';

interface Feature {
  icon: IconName;
  title: string;
  description: string;
}

@Component({
  selector: 'app-landing-features',
  imports: [Section, Card, Icon],
  template: `
    <div class="border-y border-zinc-200 bg-zinc-50">
      <ui-section id="features" spacing="default">
        <div class="mx-auto max-w-2xl text-center">
          <p
            class="text-xs font-semibold uppercase tracking-widest text-indigo-600"
          >
            Why Upskills
          </p>
          <h2
            class="mt-3 text-balance text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
          >
            Built for people who learn by doing
          </h2>
        </div>

        <div class="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          @for (feature of features; track feature.title) {
            <ui-card>
              <div class="flex h-full flex-col gap-4 p-6">
                <div
                  class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                >
                  <ui-icon [name]="feature.icon" />
                </div>
                <h3 class="text-base font-semibold text-zinc-900">
                  {{ feature.title }}
                </h3>
                <p class="text-pretty text-sm leading-6 text-zinc-600">
                  {{ feature.description }}
                </p>
              </div>
            </ui-card>
          }
        </div>
      </ui-section>
    </div>
  `,
})
export class LandingFeaturesComponent {
  readonly features: readonly Feature[] = [
    {
      icon: 'calendar',
      title: 'Local workshops',
      description: 'Hands-on sessions near you, in small groups.',
    },
    {
      icon: 'users',
      title: 'Grow your network',
      description: 'Meet professionals across industries who show up to learn.',
    },
    {
      icon: 'sparkles',
      title: 'Learn from practitioners',
      description: 'Led by people doing the work, not talking about it.',
    },
    {
      icon: 'check',
      title: 'Effortless signup',
      description:
        'Simple registration, transparent waitlist, easy cancellation.',
    },
  ];
}
