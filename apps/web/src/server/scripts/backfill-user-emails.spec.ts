import { describe, expect, it, vi } from 'vitest';
import {
  backfillUserEmails,
  type BackfillUserEmailsDeps,
} from './backfill-user-emails';

/**
 * The one-off `users/{uid}.email` backfill, against injected deps.
 *
 * The Firestore walk itself is a thin executable under `apps/web/scripts/`;
 * what is worth proving here is the policy: only mismatched emails are
 * rewritten, and the writer is only ever handed a uid plus a normalized email.
 */

function deps(
  overrides: Partial<BackfillUserEmailsDeps> = {},
): BackfillUserEmailsDeps {
  return {
    listUsers: vi.fn(async () => []),
    rewriteEmail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('backfillUserEmails', () => {
  it('normalizes a mixed-case email before rewriting it', async () => {
    const d = deps({
      listUsers: async () => [{ uid: 'uid-ada', email: 'Ada@Example.com' }],
    });

    await expect(backfillUserEmails(d)).resolves.toBe(1);

    expect(d.rewriteEmail).toHaveBeenCalledWith('uid-ada', 'ada@example.com');
  });

  it('skips documents whose email is already normalized', async () => {
    const d = deps({
      listUsers: async () => [{ uid: 'uid-ada', email: 'ada@example.com' }],
    });

    await expect(backfillUserEmails(d)).resolves.toBe(0);

    expect(d.rewriteEmail).not.toHaveBeenCalled();
  });

  it('hands the writer only the uid and the normalized email', async () => {
    const d = deps({
      listUsers: async () => [
        { uid: 'uid-ada', email: ' Ada@Example.COM ' },
        { uid: 'uid-bob', email: 'Bob@Example.com' },
      ],
    });

    await expect(backfillUserEmails(d)).resolves.toBe(2);

    expect(d.rewriteEmail).toHaveBeenNthCalledWith(
      1,
      'uid-ada',
      'ada@example.com',
    );
    expect(d.rewriteEmail).toHaveBeenNthCalledWith(
      2,
      'uid-bob',
      'bob@example.com',
    );

    // The contract the Firestore update relies on: the writer never receives a
    // document-shaped value, so it cannot be asked to touch `role`, `orgIds`,
    // or `createdAt`.
    for (const call of vi.mocked(d.rewriteEmail).mock.calls) {
      expect(call).toHaveLength(2);
      expect(typeof call[0]).toBe('string');
      expect(typeof call[1]).toBe('string');
    }
  });
});
