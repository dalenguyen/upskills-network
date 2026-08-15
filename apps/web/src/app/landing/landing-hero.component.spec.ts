import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingHeroComponent } from './landing-hero.component';

describe('LandingHeroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHeroComponent],
      providers: [provideHttpClient()],
    }).compileComponents();
  });

  it('renders the headline, subhead, and waitlist form', () => {
    const fixture = TestBed.createComponent(LandingHeroComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      'Grow your skills. Expand your network.',
    );
    expect(root.textContent).toContain(
      'Upskills hosts in-person workshops where professionals learn from practitioners and meet peers — no lectures, no passive webinars.',
    );
    expect(root.querySelector('app-landing-waitlist-form')).toBeTruthy();
  });
});
