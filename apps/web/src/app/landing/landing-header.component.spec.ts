import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingHeaderComponent } from './landing-header.component';

describe('LandingHeaderComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHeaderComponent],
    }).compileComponents();
  });

  it('renders the wordmark and a waitlist call-to-action anchor', () => {
    const fixture = TestBed.createComponent(LandingHeaderComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills');

    const callToAction = root.querySelector('a[href="/#waitlist"]');
    expect(callToAction?.textContent?.trim()).toBe('Join the waitlist');
  });
});
