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
            Built for people who run workshops
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
      icon: 'ticket',
      title: 'Real capacity limits',
      description:
        "Registration is a database transaction — a full event can't be oversold, even when two people register at once.",
    },
    {
      icon: 'users',
      title: 'The waitlist runs itself',
      description:
        'Past capacity, guests land on a waitlist and move up automatically when someone cancels.',
    },
    {
      icon: 'sparkles',
      title: 'Emails sent for you',
      description:
        'Confirmation, waitlist, and reminder emails go out without you touching an inbox.',
    },
    {
      icon: 'external-link',
      title: 'Open source, self-hostable',
      description:
        'MIT licensed. Use the free hosted version, or run it yourself on your own Firebase project.',
    },
  ];
}
