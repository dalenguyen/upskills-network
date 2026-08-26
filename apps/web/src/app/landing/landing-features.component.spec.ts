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

    expect(root.textContent).toContain('Real capacity limits');
    expect(root.textContent).toContain(
      "Registration is a database transaction — a full event can't be oversold, even when two people register at once.",
    );
    expect(root.textContent).toContain('The waitlist runs itself');
    expect(root.textContent).toContain(
      'Past capacity, guests land on a waitlist and move up automatically when someone cancels.',
    );
    expect(root.textContent).toContain('Emails sent for you');
    expect(root.textContent).toContain(
      'Confirmation, waitlist, and reminder emails go out without you touching an inbox.',
    );
    expect(root.textContent).toContain('Open source, self-hostable');
    expect(root.textContent).toContain(
      'MIT licensed. Use the free hosted version, or run it yourself on your own Firebase project.',
    );
  });
});
