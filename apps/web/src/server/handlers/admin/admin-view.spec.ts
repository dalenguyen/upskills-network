import { describe, expect, it } from 'vitest';
import { fakeTimestamp } from '../../testing/fakes';
import { FIXTURE_START, fakeOrg } from '../../testing/public-fixtures';
import { toAdminOrg } from './admin-view';

/**
 * The admin projection is the one place a raw `Organizer` may legitimately be
 * turned into the shape the admin console consumes. The assertions here are
 * about the wire format: the full roster is present, and every Firestore
 * `Timestamp` has become an ISO-8601 string before it can be JSON-serialized.
 */

describe('toAdminOrg', () => {
  it('serializes createdAt as an ISO-8601 string', () => {
    const view = toAdminOrg(
      fakeOrg({
        createdAt: fakeTimestamp(new Date('2026-09-01T18:00:00.000Z')),
      }),
    );

    expect(view.createdAt).toBe('2026-09-01T18:00:00.000Z');
    expect(typeof view.createdAt).toBe('string');
  });

  it('serializes every membership addedAt as an ISO-8601 string', () => {
    const view = toAdminOrg(
      fakeOrg({
        members: {
          'uid-1': { role: 'admin', addedAt: fakeTimestamp(FIXTURE_START) },
          'uid-2': {
            role: 'manager',
            addedAt: fakeTimestamp(new Date('2026-09-02T12:00:00.000Z')),
          },
        },
      }),
    );

    expect(view.members).toEqual({
      'uid-1': {
        role: 'admin',
        addedAt: '2026-09-01T18:00:00.000Z',
      },
      'uid-2': {
        role: 'manager',
        addedAt: '2026-09-02T12:00:00.000Z',
      },
    });
  });

  it('publishes the full member roster keyed by uid', () => {
    const view = toAdminOrg(
      fakeOrg({
        createdBy: 'uid-1',
        memberUids: ['uid-1', 'uid-2'],
        members: {
          'uid-1': { role: 'admin', addedAt: fakeTimestamp(FIXTURE_START) },
          'uid-2': {
            role: 'manager',
            addedAt: fakeTimestamp(FIXTURE_START),
          },
        },
      }),
    );

    expect(view).toMatchObject({
      orgId: 'org-1',
      name: 'Upskills Toronto',
      slug: 'upskills-toronto',
      createdBy: 'uid-1',
      memberUids: ['uid-1', 'uid-2'],
      members: {
        'uid-1': { role: 'admin' },
        'uid-2': { role: 'manager' },
      },
    });
  });
});
