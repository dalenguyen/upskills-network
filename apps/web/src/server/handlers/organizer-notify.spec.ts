import { describe, expect, it, vi } from 'vitest';
import { fakeTimestamp } from '../testing/fakes';
import {
  FIXTURE_EMAILS,
  FIXTURE_START,
  fakeEvent,
  fakeOrg,
} from '../testing/public-fixtures';
import {
  createOrganizerNotifier,
  recipientsOf,
  type OrganizerNotifyDeps,
} from './organizer-notify';

/**
 * The organizer fan-out, and the several ways it is allowed to do nothing.
 *
 * Every call site is post-commit, so the property under test throughout is that
 * nothing here rejects — see the module comment on `organizer-notify.ts`.
 */

function deps(overrides: Partial<OrganizerNotifyDeps> = {}) {
  return {
    getOrg: vi.fn(async () => fakeOrg()),
    getUserEmails: vi.fn(async () => FIXTURE_EMAILS),
    sendOrganizerNotification: vi.fn(async () => ({
      recipients: 1,
      sent: 1,
      results: [],
    })),
    ...overrides,
  } satisfies OrganizerNotifyDeps;
}

describe('createOrganizerNotifier', () => {
  it('mails the org roster with the resolved addresses', async () => {
    const wired = deps();
    const event = fakeEvent();

    await createOrganizerNotifier(wired)('org-1', event, 'registration', {
      guest: { name: 'Ada', email: 'ada@example.com' },
    });

    expect(wired.getUserEmails).toHaveBeenCalledWith(['uid-1']);
    expect(wired.sendOrganizerNotification).toHaveBeenCalledWith(
      [{ email: 'ada@example.com', role: 'admin' }],
      event,
      'registration',
      { guest: { name: 'Ada', email: 'ada@example.com' } },
    );
  });

  it('defaults the details so a caller can omit them', async () => {
    const wired = deps();

    await createOrganizerNotifier(wired)('org-1', fakeEvent(), 'cancellation');

    expect(wired.sendOrganizerNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'cancellation',
      {},
    );
  });

  it('sends nothing when the org is gone', async () => {
    const wired = deps({ getOrg: vi.fn(async () => null) });

    await createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration');

    expect(wired.getUserEmails).not.toHaveBeenCalled();
    expect(wired.sendOrganizerNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when the org has no members', async () => {
    const wired = deps({
      getOrg: vi.fn(async () => fakeOrg({ members: {}, memberUids: [] })),
    });

    await createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration');

    expect(wired.getUserEmails).not.toHaveBeenCalled();
    expect(wired.sendOrganizerNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when no member address could be resolved', async () => {
    const wired = deps({ getUserEmails: vi.fn(async () => ({})) });

    await createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration');

    expect(wired.sendOrganizerNotification).not.toHaveBeenCalled();
  });

  // The three failures below each happen after a registration has committed.
  // Any of them rejecting would turn a taken seat into a 500.
  it('swallows a failed org read', async () => {
    const wired = deps({
      getOrg: vi.fn(async () => {
        throw new Error('firestore unavailable');
      }),
    });

    await expect(
      createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration'),
    ).resolves.toBeUndefined();
  });

  it('swallows a failed address lookup', async () => {
    const wired = deps({
      getUserEmails: vi.fn(async () => {
        throw new Error('getAll failed');
      }),
    });

    await expect(
      createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration'),
    ).resolves.toBeUndefined();
  });

  it('swallows a failed send', async () => {
    const wired = deps({
      sendOrganizerNotification: vi.fn(async () => {
        throw new Error('resend exploded');
      }),
    });

    await expect(
      createOrganizerNotifier(wired)('org-1', fakeEvent(), 'registration'),
    ).resolves.toBeUndefined();
  });
});

describe('recipientsOf', () => {
  it('drops members whose address is unknown', () => {
    const org = fakeOrg({
      members: {
        'uid-1': { role: 'admin', addedAt: fakeTimestamp(FIXTURE_START) },
        'uid-2': { role: 'volunteer', addedAt: fakeTimestamp(FIXTURE_START) },
      },
      memberUids: ['uid-1', 'uid-2'],
    });

    // `uid-2` has no `users/{uid}` document yet — a member who was invited and
    // has not signed in. Mailing a uid would be a guaranteed Resend rejection.
    expect(recipientsOf(org, FIXTURE_EMAILS)).toEqual([
      { email: 'ada@example.com', role: 'admin' },
    ]);
  });

  it('carries each member role through for the send-side role filter', () => {
    const org = fakeOrg({
      members: {
        'uid-1': { role: 'check_in', addedAt: fakeTimestamp(FIXTURE_START) },
      },
      memberUids: ['uid-1'],
    });

    expect(recipientsOf(org, FIXTURE_EMAILS)).toEqual([
      { email: 'ada@example.com', role: 'check_in' },
    ]);
  });
});
