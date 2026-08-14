import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Guest, WorkshopEvent } from '@upskills/models';
import { dataAccessStripe } from '@upskills/stripe';
import { Ui } from '@upskills/ui';
import { normalizeEmail } from '@upskills/validation';

/**
 * Alias resolution for the libraries that are safe in a browser, checked in the
 * app's jsdom environment.
 *
 * The server-only libs — auth, email, firestore — are covered by
 * `src/server/alias-smoke.spec.ts` instead, because they wrap the Firebase
 * Admin SDK and Resend and are never part of a browser bundle. See that file
 * for why the split is load-bearing rather than cosmetic.
 *
 * Each lib is probed with a real exported *function* wherever it has one. A
 * bare `const` is weaker evidence than it looks: a bundler may inline the
 * value, so the assertion can pass against a copy without the module ever being
 * resolved and executed. Calling a function cannot be satisfied that way.
 */
describe('workspace aliases', () => {
  it('resolves the validation lib', () => {
    expect(normalizeEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('resolves the Angular ui lib', () => {
    expect(new Ui()).toBeInstanceOf(Ui);
  });

  // Still the generator placeholder: @upskills/stripe has no real API yet.
  // Replace this the moment it does — see the Stripe epic.
  it('resolves the stripe lib', () => {
    expect(dataAccessStripe()).toBe('data-access-stripe');
  });

  // @upskills/models is types-only by design (no runtime imports), so it is
  // asserted at the type level rather than by calling into it.
  it('resolves the models lib types', () => {
    expectTypeOf<WorkshopEvent['currency']>().toEqualTypeOf<'cad'>();
    expectTypeOf<Guest['guestId']>().toEqualTypeOf<string>();
  });
});
