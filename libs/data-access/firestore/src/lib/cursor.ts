import type { WorkshopEvent } from '@upskills/models';

/**
 * The decoded form of a page cursor: the sort key of the last event on the
 * previous page, plus its id as the tie-breaker.
 */
export interface EventCursor {
  /** `startsAt` in epoch milliseconds. */
  startsAtMs: number;
  eventId: string;
  /**
   * Owning organizer of the cursor's event.
   *
   * Needed because events live at `organizers/{orgId}/events/{eventId}` and the
   * public browse is a **collection-group** query. Firestore requires the
   * `__name__` value of such a query's cursor to be a full document path — a
   * bare id is rejected outright ("must result in a valid document path"), so
   * the organizer has to travel in the cursor to rebuild it.
   */
  orgId: string;
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
  event: Pick<WorkshopEvent, 'eventId' | 'orgId' | 'startsAt'>,
): string {
  const cursor: EventCursor = {
    startsAtMs: event.startsAt.toMillis(),
    eventId: event.eventId,
    orgId: event.orgId,
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
    (parsed as EventCursor).eventId === '' ||
    typeof (parsed as EventCursor).orgId !== 'string' ||
    (parsed as EventCursor).orgId === ''
  ) {
    throw new Error('Invalid cursor');
  }

  return {
    startsAtMs: (parsed as EventCursor).startsAtMs,
    eventId: (parsed as EventCursor).eventId,
    orgId: (parsed as EventCursor).orgId,
  };
}
