import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingHowItWorksComponent } from './landing-how-it-works.component';

describe('LandingHowItWorksComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHowItWorksComponent],
    }).compileComponents();
  });

  it('renders the three steps in order', () => {
    const fixture = TestBed.createComponent(LandingHowItWorksComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const steps = Array.from(root.querySelectorAll('li'));
    expect(steps).toHaveLength(3);

    expect(steps[0].textContent).toContain('Step 1');
    expect(steps[0].textContent).toContain('Join the waitlist');
    expect(steps[1].textContent).toContain('Step 2');
    expect(steps[1].textContent).toContain('Pick a workshop');
    expect(steps[2].textContent).toContain('Step 3');
    expect(steps[2].textContent).toContain('Show up and connect');
  });

  it('exposes an anchor target for the header nav link', () => {
    const fixture = TestBed.createComponent(LandingHowItWorksComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#how-it-works')).toBeTruthy();
  });
});
