import { Component } from '@angular/core';

import { LandingFeaturesComponent } from '../landing/landing-features.component';
import { LandingFooterComponent } from '../landing/landing-footer.component';
import { LandingHeaderComponent } from '../landing/landing-header.component';
import { LandingHeroComponent } from '../landing/landing-hero.component';
import { LandingHowItWorksComponent } from '../landing/landing-how-it-works.component';

@Component({
  selector: 'app-home',
  imports: [
    LandingHeaderComponent,
    LandingHeroComponent,
    LandingHowItWorksComponent,
    LandingFeaturesComponent,
    LandingFooterComponent,
  ],
  template: `
    <app-landing-header />
    <main>
      <app-landing-hero />
      <app-landing-how-it-works />
      <app-landing-features />
    </main>
    <app-landing-footer />
  `,
})
export default class HomeComponent {}
