import { describe, expect, it } from 'vitest';

import { readFirebaseWebConfig } from './firebase-config';

/**
 * The all-or-nothing rule is what these cover. Whether the `VITE_FIREBASE_*`
 * names in `firebaseWebConfigEnv()` match what a deploy sets is *not* testable
 * here — Vite substitutes those reads at transform time, including under Vitest
 * — so it stays a deploy-time concern. See `firebase-config.ts`.
 */
describe('readFirebaseWebConfig', () => {
  const complete = {
    apiKey: 'api-key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'example',
    appId: '1:2:web:3',
  };

  it('is null in a build with no Firebase config', () => {
    // No argument: the real `import.meta.env` reads, in a test build that sets
    // none of them.
    expect(readFirebaseWebConfig()).toBeNull();
  });

  it('accepts a complete config', () => {
    expect(readFirebaseWebConfig(complete)).toEqual(complete);
  });

  /**
   * A partial config is treated as no config. Half a config fails inside
   * `initializeApp` on first use, a long way from the deploy that caused it.
   */
  it.each(Object.keys(complete) as (keyof typeof complete)[])(
    'is null when %s is missing',
    (key) => {
      expect(
        readFirebaseWebConfig({ ...complete, [key]: undefined }),
      ).toBeNull();
    },
  );

  it('treats a blank value as missing, as a failed substitution leaves it', () => {
    expect(readFirebaseWebConfig({ ...complete, appId: '   ' })).toBeNull();
  });
});
