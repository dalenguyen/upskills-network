import { Component } from '@angular/core';

import { LandingFeaturesComponent } from '../landing/landing-features.component';
import { LandingFooterComponent } from '../landing/landing-footer.component';
import { LandingHeaderComponent } from '../landing/landing-header.component';
import { LandingHeroComponent } from '../landing/landing-hero.component';

@Component({
  selector: 'app-home',
  imports: [
    LandingHeaderComponent,
    LandingHeroComponent,
    LandingFeaturesComponent,
    LandingFooterComponent,
  ],
  template: `
    <app-landing-header />
    <main>
      <app-landing-hero />
      <app-landing-features />
    </main>
    <app-landing-footer />
  `,
})
export default class HomeComponent {}
