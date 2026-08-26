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
    expect(steps[0].textContent).toContain('Create your event');
    expect(steps[1].textContent).toContain('Step 2');
    expect(steps[1].textContent).toContain('Publish and share the link');
    expect(steps[2].textContent).toContain('Step 3');
    expect(steps[2].textContent).toContain('Registrations run themselves');
  });

  // <ol> admits only <li> and script-supporting elements. The decorative
  // connector used to sit inside the list, which degrades the semantics screen
  // readers announce for it.
  it('keeps non-list elements out of the ordered list', () => {
    const fixture = TestBed.createComponent(LandingHowItWorksComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const list = root.querySelector('ol');
    expect(list).toBeTruthy();

    const nonListChildren = Array.from(list!.children).filter(
      (child) => child.tagName.toLowerCase() !== 'li',
    );
    expect(nonListChildren).toEqual([]);
  });

  it('exposes an anchor target for the header nav link', () => {
    const fixture = TestBed.createComponent(LandingHowItWorksComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#how-it-works')).toBeTruthy();
  });
});
