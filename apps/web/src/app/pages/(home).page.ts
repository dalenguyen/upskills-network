import { Component } from '@angular/core';

import { AnalogWelcomeComponent } from './analog-welcome.component';

@Component({
  selector: 'web-home',

  imports: [AnalogWelcomeComponent],
  template: ` <web-analog-welcome /> `,
})
export default class HomeComponent {}
