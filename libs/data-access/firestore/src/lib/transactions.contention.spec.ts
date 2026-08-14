import { describe, expect, it } from 'vitest';

import { clearFirestore } from '../testing/emulator';
import { seedEvent } from '../testing/seed';
import { eventRef } from './collections';
import { runTransaction, TransactionContendedError } from './transactions';

/**
 * Guards the retry policy itself.
 *
 * The policy has to tell two failures apart: contention, which is normal and
 * should be retried on a fresh transaction, and a genuine fault, which must
 * surface unchanged. Retrying a real bug five times and then reporting it as
 * contention would hide it exactly when it matters.
 */
describe('runTransaction retry policy', () => {
  it('lets a non-contention error through untouched', async () => {
    await clearFirestore();
    await seedEvent({ eventId: 'evt-policy' });

    class BusinessRuleError extends Error {}

    let attempts = 0;
    await expect(
      runTransaction(async (transaction) => {
        attempts++;
        await transaction.get(eventRef('evt-policy'));
        throw new BusinessRuleError('not contention');
      }),
    ).rejects.toThrow(BusinessRuleError);

    // Once — not retried, and not rewrapped as contention.
    expect(attempts).toBe(1);
  });

  it('does not treat an unrelated INVALID_ARGUMENT as contention', async () => {
    await clearFirestore();
    await seedEvent({ eventId: 'evt-policy-2' });

    // Same gRPC code as the stale-transaction case, different meaning: only the
    // stale-handle message may be retried.
    const bug = Object.assign(new Error('some other invalid argument'), {
      code: 3,
    });

    let attempts = 0;
    await expect(
      runTransaction(async (transaction) => {
        attempts++;
        await transaction.get(eventRef('evt-policy-2'));
        throw bug;
      }),
    ).rejects.toThrow('some other invalid argument');

    expect(attempts).toBe(1);
  });

  it('exposes TransactionContendedError for callers to map to a retry', () => {
    const error = new TransactionContendedError(5);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionContendedError');
    expect(error.restarts).toBe(5);
  });
});
