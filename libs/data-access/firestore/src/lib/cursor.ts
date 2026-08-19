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

/**
 * Whether an id can safely become one segment of a document path.
 *
 * A cursor arrives base64-encoded from `?cursor=`, which makes both ids inside
 * it **attacker-controlled**. `documentIdCursor` in `reads.ts` splices them into
 * `organizers/{orgId}/events/{eventId}` for the collection-group query, so a `/`
 * smuggled into either one changes the segment count of that path. Firestore
 * then rejects it with a raw `invalid-argument` that `rethrowAsBadCursor` does
 * not recognise — it only maps the literal `Invalid cursor` — so a malformed
 * cursor would surface as a **500** instead of the 400 it is.
 *
 * Rejecting the separator here keeps that decision in the one place that parses
 * untrusted input, and keeps every path built downstream well-formed by
 * construction. Firestore's own generated ids never contain `/`, so nothing
 * legitimate is excluded.
 */
function isPathSegment(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.includes('/');
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
    !isPathSegment((parsed as EventCursor).eventId) ||
    !isPathSegment((parsed as EventCursor).orgId)
  ) {
    throw new Error('Invalid cursor');
  }

  return {
    startsAtMs: (parsed as EventCursor).startsAtMs,
    eventId: (parsed as EventCursor).eventId,
    orgId: (parsed as EventCursor).orgId,
  };
}
