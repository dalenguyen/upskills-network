import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingFooterComponent } from './landing-footer.component';

describe('LandingFooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingFooterComponent],
    }).compileComponents();
  });

  it('renders the wordmark, copyright, and email link', () => {
    const fixture = TestBed.createComponent(LandingFooterComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upskills');
    expect(root.textContent).toContain('© 2026 Upskills');
    expect(
      root.querySelector('a[href="mailto:hello@upskills.com"]'),
    ).toBeTruthy();
  });
});
