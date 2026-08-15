import { Component } from '@angular/core';

@Component({
  selector: 'ui-card',
  imports: [],
  // Cards are usually grid items that should match their tallest sibling, so
  // the host is a full-height block for the inner `h-full` to resolve against.
  host: { class: 'block h-full' },
  template: `
    <div
      class="h-full rounded-2xl border border-zinc-200 bg-white font-sans shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-600/10 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <ng-content></ng-content>
    </div>
  `,
})
export class Card {}
