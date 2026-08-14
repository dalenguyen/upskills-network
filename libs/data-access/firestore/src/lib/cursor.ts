import type { WorkshopEvent } from '@upskills/models';

/**
 * The decoded form of a page cursor: the sort key of the last event on the
 * previous page, plus its id as the tie-breaker.
 */
export interface EventCursor {
  /** `startsAt` in epoch milliseconds. */
  startsAtMs: number;
  eventId: string;
}

/**
 * Encode the position *after* `event` as an opaque, URL-safe string.
 *
 * The cursor carries the sort key itself rather than just a doc id, so paging
 * costs no extra read and — more importantly — a page still resolves after the
 * cursor's own event has been deleted. Callers must treat the string as opaque;
 * the encoding is free to change.
 */
export function encodeEventCursor(
  event: Pick<WorkshopEvent, 'eventId' | 'startsAt'>,
): string {
  const cursor: EventCursor = {
    startsAtMs: event.startsAt.toMillis(),
    eventId: event.eventId,
  };

  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Reverse of {@link encodeEventCursor}. Throws on anything malformed. */
export function decodeEventCursor(cursor: string): EventCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid cursor');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as EventCursor).startsAtMs !== 'number' ||
    !Number.isFinite((parsed as EventCursor).startsAtMs) ||
    typeof (parsed as EventCursor).eventId !== 'string' ||
    (parsed as EventCursor).eventId === ''
  ) {
    throw new Error('Invalid cursor');
  }

  return {
    startsAtMs: (parsed as EventCursor).startsAtMs,
    eventId: (parsed as EventCursor).eventId,
  };
}
