import type { WorkshopEvent } from '@upskills/models';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { decodeEventCursor, encodeEventCursor } from './cursor';

function eventAt(
  iso: string,
  eventId: string,
  orgId = 'org-1',
): Pick<WorkshopEvent, 'eventId' | 'orgId' | 'startsAt'> {
  return { startsAt: Timestamp.fromDate(new Date(iso)), eventId, orgId };
}

describe('event cursor', () => {
  it('round-trips the sort key and the tie-breaker id', () => {
    const cursor = encodeEventCursor(
      eventAt('2026-09-01T18:00:00.000Z', 'evt-7'),
    );

    expect(decodeEventCursor(cursor)).toEqual({
      startsAtMs: Date.parse('2026-09-01T18:00:00.000Z'),
      eventId: 'evt-7',
      orgId: 'org-1',
    });
  });

  // The browse listing is a collection-group query, and Firestore will only
  // accept a full document path as its `__name__` cursor. Without the org the
  // second page throws rather than paging — see `documentIdCursor` in reads.ts.
  it('carries the organizer, so a collection-group path can be rebuilt', () => {
    const cursor = encodeEventCursor(
      eventAt('2026-09-01T18:00:00.000Z', 'evt-7', 'org-9'),
    );

    expect(decodeEventCursor(cursor).orgId).toBe('org-9');
  });

  // The cursor arrives base64-encoded from `?cursor=`, so both ids are
  // attacker-controlled and get spliced into a document path. A `/` would change
  // the path's segment count and make Firestore throw a raw `invalid-argument`,
  // which the route maps to 500 rather than the 400 it should be.
  it.each([
    { startsAtMs: 1, eventId: 'a/b', orgId: 'org-1' },
    { startsAtMs: 1, eventId: 'evt-1', orgId: 'a/b' },
    { startsAtMs: 1, eventId: 'evt-1', orgId: '../../users/uid-1' },
  ])('rejects %j, which would smuggle a path segment', (payload) => {
    const bad = Buffer.from(JSON.stringify(payload)).toString('base64url');

    expect(() => decodeEventCursor(bad)).toThrow('Invalid cursor');
  });

  it('rejects a cursor with no organizer, which cannot address a document', () => {
    const bad = Buffer.from(
      JSON.stringify({ startsAtMs: 1, eventId: 'evt-1' }),
    ).toString('base64url');

    expect(() => decodeEventCursor(bad)).toThrow('Invalid cursor');
  });

  it('is url-safe so it can be a query parameter verbatim', () => {
    const cursor = encodeEventCursor(
      eventAt('2026-09-01T18:00:00.000Z', 'evt/7?&='),
    );

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('rejects a cursor that is not valid base64 json', () => {
    expect(() => decodeEventCursor('not-a-cursor')).toThrow('Invalid cursor');
  });

  it('rejects a cursor whose fields are the wrong shape', () => {
    const bad = Buffer.from(
      JSON.stringify({ startsAtMs: 'soon', eventId: 'evt-1', orgId: 'org-1' }),
    ).toString('base64url');

    expect(() => decodeEventCursor(bad)).toThrow('Invalid cursor');
  });
});
