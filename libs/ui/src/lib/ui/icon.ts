import { Component, Input } from '@angular/core';

export type IconName = 'calendar' | 'users' | 'sparkles' | 'check';

@Component({
  selector: 'ui-icon',
  imports: [],
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  @Input() name: IconName = 'sparkles';
}
