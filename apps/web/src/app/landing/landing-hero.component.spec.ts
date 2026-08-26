import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingHeroComponent } from './landing-hero.component';

describe('LandingHeroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHeroComponent],
    }).compileComponents();
  });

  it('renders the headline, subhead, and the create-event CTA', () => {
    const fixture = TestBed.createComponent(LandingHeroComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      'Stop running your workshop from a spreadsheet.',
    );
    expect(root.textContent).toContain(
      'Upskills is an open-source platform for people who run workshops.',
    );
    const cta = root.querySelector<HTMLAnchorElement>(
      'a[href="/auth/register"]',
    );
    expect(cta?.textContent).toContain('Create your first event');
  });
});
