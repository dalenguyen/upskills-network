import type { Auth } from 'firebase-admin/auth';
import { FakeAuth } from '../testing/fake-auth';
import {
  ADMIN_CLAIM,
  syncAdminClaim,
  withAdminClaimMirrored,
  type ClaimsAuth,
} from './admin-claim';

/** The seam must accept the real client, or these tests prove nothing. */
it('accepts the real Admin SDK client through the claims seam', () => {
  const claims: ClaimsAuth = {} as Auth;
  expect(claims).toBeDefined();
});

describe('syncAdminClaim', () => {
  it('grants the claim security rules read', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    const result = await syncAdminClaim('uid-1', 'admin', { auth });

    expect(result).toMatchObject({ uid: 'uid-1', admin: true, changed: true });
    expect(auth.account('uid-1').customClaims).toEqual({ [ADMIN_CLAIM]: true });
  });

  it('clears the claim on demotion rather than setting it false', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { admin: true };

    const result = await syncAdminClaim('uid-1', 'user', { auth });

    expect(result).toMatchObject({ admin: false, changed: true });
    expect(auth.account('uid-1').customClaims).toEqual({});
    expect(ADMIN_CLAIM in auth.account('uid-1').customClaims).toBe(false);
  });

  it('is safe to re-run: an already-correct claim is not rewritten', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    await syncAdminClaim('uid-1', 'admin', { auth });
    auth.calls.length = 0;
    const again = await syncAdminClaim('uid-1', 'admin', { auth });

    expect(again).toMatchObject({ admin: true, changed: false });
    expect(auth.calls).toEqual(['getUser']);
  });

  it('is safe to re-run a demotion on an account that never had the claim', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { tier: 'gold' };

    const result = await syncAdminClaim('uid-1', 'user', { auth });

    expect(result.changed).toBe(false);
    expect(auth.calls).toEqual(['getUser']);
    expect(auth.account('uid-1').customClaims).toEqual({ tier: 'gold' });
  });

  it('preserves unrelated claims instead of replacing the whole set', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { tier: 'gold', beta: true };

    await syncAdminClaim('uid-1', 'admin', { auth });
    expect(auth.account('uid-1').customClaims).toEqual({
      tier: 'gold',
      beta: true,
      admin: true,
    });

    await syncAdminClaim('uid-1', 'user', { auth });
    expect(auth.account('uid-1').customClaims).toEqual({
      tier: 'gold',
      beta: true,
    });
  });

  it('rewrites a stale admin:false into an absent claim', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { admin: false };

    const result = await syncAdminClaim('uid-1', 'user', { auth });

    expect(result.changed).toBe(true);
    expect(auth.account('uid-1').customClaims).toEqual({});
  });
});

describe('withAdminClaimMirrored', () => {
  it('promotes the document first and the claim second', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');
    const order: string[] = [];

    const outcome = await withAdminClaimMirrored(
      'uid-1',
      'admin',
      async () => {
        // Sampled *during* the document write: the claim must not be granted
        // yet. Comparing two lists after the fact would pass either way.
        order.push(
          ...auth.calls.filter((call) => call === 'setCustomUserClaims'),
        );
        order.push('writeRole');
        return 'written';
      },
      { auth },
    );

    order.push(...auth.calls.filter((call) => call === 'setCustomUserClaims'));
    expect(order).toEqual(['writeRole', 'setCustomUserClaims']);
    expect(outcome.result).toBe('written');
    expect(outcome.claim.admin).toBe(true);
  });

  it('demotes the claim first and the document second', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { admin: true };
    const order: string[] = [];
    const claimWrite = () => {
      // Read the fake's call log at the moment the document write happens, so
      // the assertion is about real interleaving rather than two lists merged
      // after the fact.
      order.push(
        ...auth.calls.filter((call) => call === 'setCustomUserClaims'),
      );
    };

    await withAdminClaimMirrored(
      'uid-1',
      'user',
      async () => {
        claimWrite();
        order.push('writeRole');
      },
      { auth },
    );

    expect(order).toEqual(['setCustomUserClaims', 'writeRole']);
    expect(auth.account('uid-1').customClaims).toEqual({});
  });

  it('never grants the claim when the promotion write fails', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    await expect(
      withAdminClaimMirrored(
        'uid-1',
        'admin',
        () => Promise.reject(new Error('firestore is down')),
        { auth },
      ),
    ).rejects.toThrow('firestore is down');

    // The half-applied state is "not an admin anywhere", which is the safe one.
    expect(auth.account('uid-1').customClaims).toEqual({});
    expect(auth.calls).not.toContain('setCustomUserClaims');
  });

  it('has already dropped the claim when the demotion write fails', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { admin: true };

    await expect(
      withAdminClaimMirrored(
        'uid-1',
        'user',
        () => Promise.reject(new Error('firestore is down')),
        { auth },
      ),
    ).rejects.toThrow('firestore is down');

    // Still an admin in Firestore, but no longer to security rules.
    expect(auth.account('uid-1').customClaims).toEqual({});
  });

  it('revokes sessions on demotion so the old claim cannot outlive it', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1').customClaims = { admin: true };

    const outcome = await withAdminClaimMirrored(
      'uid-1',
      'user',
      () => Promise.resolve(),
      { auth },
    );

    expect(outcome.sessionsRevoked).toBe(true);
    expect(auth.calls).toContain('revokeRefreshTokens');
  });

  it('leaves a promoted user signed in', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    const outcome = await withAdminClaimMirrored(
      'uid-1',
      'admin',
      () => Promise.resolve(),
      { auth },
    );

    expect(outcome.sessionsRevoked).toBe(false);
    expect(auth.calls).not.toContain('revokeRefreshTokens');
  });

  it('honors an explicit revokeSessions in either direction', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    const promotion = await withAdminClaimMirrored(
      'uid-1',
      'admin',
      () => Promise.resolve(),
      { auth, revokeSessions: true },
    );
    expect(promotion.sessionsRevoked).toBe(true);
    expect(auth.calls).toContain('revokeRefreshTokens');

    auth.calls.length = 0;
    const demotion = await withAdminClaimMirrored(
      'uid-1',
      'user',
      () => Promise.resolve(),
      { auth, revokeSessions: false },
    );
    expect(demotion.sessionsRevoked).toBe(false);
    expect(auth.calls).not.toContain('revokeRefreshTokens');
  });

  it('is safe to re-run after a partial failure', async () => {
    const auth = new FakeAuth();
    auth.account('uid-1');

    await withAdminClaimMirrored('uid-1', 'admin', () => Promise.resolve(), {
      auth,
    }).catch(() => undefined);
    const second = await withAdminClaimMirrored(
      'uid-1',
      'admin',
      () => Promise.resolve(),
      { auth },
    );

    expect(second.claim.changed).toBe(false);
    expect(auth.account('uid-1').customClaims).toEqual({ admin: true });
  });
});
