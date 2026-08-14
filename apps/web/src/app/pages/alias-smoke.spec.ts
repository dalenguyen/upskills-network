import { describe, expect, expectTypeOf, it } from 'vitest';

import { dataAccessAuth } from '@upskills/auth';
import { dataAccessEmail } from '@upskills/email';
import { dataAccessFirestore } from '@upskills/firestore';
import type { Guest, WorkshopEvent } from '@upskills/models';
import { dataAccessStripe } from '@upskills/stripe';
import { Ui } from '@upskills/ui';
import { normalizeEmail } from '@upskills/validation';

// Proves every workspace alias resolves from inside the app, both for the
// TypeScript compiler and for the Vite/Nx path resolution at runtime.
describe('workspace aliases', () => {
  it('resolves the data-access lib entry points', () => {
    expect([
      dataAccessFirestore(),
      dataAccessAuth(),
      dataAccessEmail(),
      dataAccessStripe(),
    ]).toEqual([
      'data-access-firestore',
      'data-access-auth',
      'data-access-email',
      'data-access-stripe',
    ]);
  });

  it('resolves the validation lib', () => {
    expect(normalizeEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('resolves the Angular ui lib', () => {
    expect(new Ui()).toBeInstanceOf(Ui);
  });

  // @upskills/models is types-only by design (no runtime imports), so it is
  // asserted at the type level rather than by calling into it.
  it('resolves the models lib types', () => {
    expectTypeOf<WorkshopEvent['currency']>().toEqualTypeOf<'cad'>();
    expectTypeOf<Guest['guestId']>().toEqualTypeOf<string>();
  });
});
