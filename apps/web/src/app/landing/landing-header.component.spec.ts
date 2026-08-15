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

  it('links to sign-in, the only route into the app for a returning visitor', () => {
    const fixture = TestBed.createComponent(LandingHeaderComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    const signIn = root.querySelector('a[href="/auth/login"]');
    expect(signIn?.textContent?.trim()).toBe('Sign in');
  });

  // The section links collapse below `md`, and sign-in must not go with them:
  // no other page links to it, so a hidden link is an unreachable app.
  it('keeps sign-in outside the nav that hides on small screens', () => {
    const fixture = TestBed.createComponent(LandingHeaderComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    const signIn = root.querySelector('a[href="/auth/login"]');
    expect(signIn?.closest('nav')).toBeNull();
  });
});
