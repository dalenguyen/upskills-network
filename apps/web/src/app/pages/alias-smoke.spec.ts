import { describe, expect, it } from 'vitest';

import { dataAccessAuth } from '@upskills/auth';
import { dataAccessEmail } from '@upskills/email';
import { dataAccessFirestore } from '@upskills/firestore';
import { sharedModels } from '@upskills/models';
import { dataAccessStripe } from '@upskills/stripe';
import { Ui } from '@upskills/ui';
import { sharedValidation } from '@upskills/validation';

// Proves every workspace alias resolves from inside the app, both for the
// TypeScript compiler and for the Vite/Nx path resolution at runtime.
describe('workspace aliases', () => {
  it('resolves each lib entry point', () => {
    expect([
      sharedModels(),
      sharedValidation(),
      dataAccessFirestore(),
      dataAccessAuth(),
      dataAccessEmail(),
      dataAccessStripe(),
    ]).toEqual([
      'shared-models',
      'shared-validation',
      'data-access-firestore',
      'data-access-auth',
      'data-access-email',
      'data-access-stripe',
    ]);
  });

  it('resolves the Angular ui lib', () => {
    expect(new Ui()).toBeInstanceOf(Ui);
  });
});
