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
    <ui-section>
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        @for (feature of features; track feature.title) {
          <ui-card>
            <div class="flex h-full flex-col gap-4 p-6">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
              >
                <ui-icon [name]="feature.icon" />
              </div>
              <h3 class="text-lg font-semibold text-zinc-900">
                {{ feature.title }}
              </h3>
              <p class="text-sm leading-6 text-zinc-600">
                {{ feature.description }}
              </p>
            </div>
          </ui-card>
        }
      </div>
    </ui-section>
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
