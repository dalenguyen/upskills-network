import { Component } from '@angular/core';

@Component({
  selector: 'ui-badge',
  imports: [],
  host: { class: 'inline-flex' },
  template: `
    <span
      class="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3.5 py-1.5 font-sans text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100"
    >
      <ng-content></ng-content>
    </span>
  `,
})
export class Badge {}
