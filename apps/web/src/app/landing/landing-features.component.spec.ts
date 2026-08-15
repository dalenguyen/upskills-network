import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LandingFeaturesComponent } from './landing-features.component';

describe('LandingFeaturesComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingFeaturesComponent],
    }).compileComponents();
  });

  it('renders all four features as cards', () => {
    const fixture = TestBed.createComponent(LandingFeaturesComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('ui-card')).toHaveLength(4);

    expect(root.textContent).toContain('Local workshops');
    expect(root.textContent).toContain(
      'Hands-on sessions near you, in small groups.',
    );
    expect(root.textContent).toContain('Grow your network');
    expect(root.textContent).toContain(
      'Meet professionals across industries who show up to learn.',
    );
    expect(root.textContent).toContain('Learn from practitioners');
    expect(root.textContent).toContain(
      'Led by people doing the work, not talking about it.',
    );
    expect(root.textContent).toContain('Effortless signup');
    expect(root.textContent).toContain(
      'Simple registration, transparent waitlist, easy cancellation.',
    );
  });
});
