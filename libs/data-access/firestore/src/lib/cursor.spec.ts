import type { WorkshopEvent } from '@upskills/models';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { decodeEventCursor, encodeEventCursor } from './cursor';

function eventAt(
  iso: string,
  eventId: string,
): Pick<WorkshopEvent, 'eventId' | 'startsAt'> {
  return { startsAt: Timestamp.fromDate(new Date(iso)), eventId };
}

describe('event cursor', () => {
  it('round-trips the sort key and the tie-breaker id', () => {
    const cursor = encodeEventCursor(
      eventAt('2026-09-01T18:00:00.000Z', 'evt-7'),
    );

    expect(decodeEventCursor(cursor)).toEqual({
      startsAtMs: Date.parse('2026-09-01T18:00:00.000Z'),
      eventId: 'evt-7',
    });
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
      JSON.stringify({ startsAtMs: 'soon', eventId: 'evt-1' }),
    ).toString('base64url');

    expect(() => decodeEventCursor(bad)).toThrow('Invalid cursor');
  });
});
