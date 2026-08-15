import type {
  Guest,
  GuestStatus,
  Organizer,
  User,
  WorkshopEvent,
} from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';
import {
  FieldPath,
  Timestamp,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import {
  eventRef,
  eventSlugRef,
  eventsCol,
  guestRef,
  guestsCol,
  guestsGroup,
  orgRef,
  orgSlugRef,
  userRef,
} from './collections';
import { decodeEventCursor, encodeEventCursor } from './cursor';

/**
 * Non-mutating reads. Every helper returns `null` (or an empty array) for a
 * missing document — a caller asking for something that is not there is a
 * normal outcome here, not an exception.
 *
 * Each helper stamps the document id back onto the model (`uid`, `orgId`,
 * `eventId`, `guestId`), so the id is trustworthy even if a writer ever forgets
 * to duplicate it into the document body.
 */

/** Default page size for {@link listPublishedEvents}. */
export const DEFAULT_PAGE_SIZE = 20;

/** Hard ceiling on a page, so a caller-supplied limit cannot scan the world. */
export const MAX_PAGE_SIZE = 100;

function userFrom(snapshot: DocumentSnapshot<User>): User | null {
  const data = snapshot.data();
  return data ? { ...data, uid: snapshot.id } : null;
}

function orgFrom(snapshot: DocumentSnapshot<Organizer>): Organizer | null {
  const data = snapshot.data();
  return data ? { ...data, orgId: snapshot.id } : null;
}

function eventFrom(
  snapshot: DocumentSnapshot<WorkshopEvent>,
): WorkshopEvent | null {
  const data = snapshot.data();
  return data ? { ...data, eventId: snapshot.id } : null;
}

function eventFromQueryDoc(
  snapshot: QueryDocumentSnapshot<WorkshopEvent>,
): WorkshopEvent {
  return { ...snapshot.data(), eventId: snapshot.id };
}

function guestFromQueryDoc(snapshot: QueryDocumentSnapshot<Guest>): Guest {
  const data = snapshot.data();

  return {
    ...data,
    guestId: snapshot.id,
    // `events/{eventId}/guests/{guestId}` — the path is authoritative, which
    // matters for collection-group hits where the caller never named the event.
    eventId: snapshot.ref.parent.parent?.id ?? data.eventId,
  };
}

function guestFrom(snapshot: DocumentSnapshot<Guest>): Guest | null {
  return snapshot.exists
    ? guestFromQueryDoc(snapshot as QueryDocumentSnapshot<Guest>)
    : null;
}

/** `users/{uid}` */
export async function getUser(uid: string): Promise<User | null> {
  return userFrom(await userRef(uid).get());
}

/** `organizers/{orgId}` */
export async function getOrg(orgId: string): Promise<Organizer | null> {
  return orgFrom(await orgRef(orgId).get());
}

/**
 * Two indexed `get()`s: the `orgSlugs/{slug}` reservation doc, then the
 * organizer it points at. Never a `where('slug', '==', …)` query.
 *
 * A reservation pointing at a deleted organizer reads as `null` rather than
 * throwing — a dangling reservation is a data problem, not a caller problem.
 */
export async function getOrgBySlug(slug: string): Promise<Organizer | null> {
  const reservation = (await orgSlugRef(slug).get()).data();
  return reservation ? getOrg(reservation.orgId) : null;
}

/** `events/{eventId}` */
export async function getEvent(eventId: string): Promise<WorkshopEvent | null> {
  return eventFrom(await eventRef(eventId).get());
}

/**
 * The public event page's lookup: `eventSlugs/{slug}` → `events/{eventId}`.
 *
 * Two key reads rather than a `where('slug', '==', …)` query — the same doc
 * count, but no query planning, no extra index, and the reservation doc is what
 * guarantees slug uniqueness in the first place.
 */
export async function getEventBySlug(
  slug: string,
): Promise<WorkshopEvent | null> {
  const reservation = (await eventSlugRef(slug).get()).data();
  return reservation ? getEvent(reservation.eventId) : null;
}

export interface ListPublishedEventsOptions {
  /** Opaque cursor from a previous page. Omit for the first page. */
  cursor?: string | null;
  /** Page size; defaults to {@link DEFAULT_PAGE_SIZE}, capped at {@link MAX_PAGE_SIZE}. */
  limit?: number;
}

export interface PublishedEventsPage {
  events: WorkshopEvent[];
  /** Pass back as `cursor` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

/**
 * Public browse: every org's published events, soonest first, one page at a
 * time. Backed by the `events (status ASC, startsAt ASC)` composite index.
 */
export async function listPublishedEvents(
  options: ListPublishedEventsOptions = {},
): Promise<PublishedEventsPage> {
  return pageOfEvents(eventsCol().where('status', '==', 'published'), options);
}

/**
 * The public organizer page: one org's published events, soonest first.
 *
 * Backed by the `events (orgId ASC, status ASC, startsAt ASC)` composite index,
 * which exists only for this query — the dashboard's
 * `(orgId ASC, startsAt DESC)` index cannot serve it, because adding the
 * `status` equality filter changes the required index prefix.
 *
 * Deliberately separate from {@link listOrgEvents} rather than a `status`
 * option on it. The dashboard lists every status newest-first so an organizer
 * sees what they just edited; the public page lists published events
 * soonest-first so a visitor sees what they can still attend. Same collection,
 * two different questions, and folding them together would mean one call site
 * silently depending on the other's default.
 */
export async function listPublishedOrgEvents(
  orgId: string,
  options: ListPublishedEventsOptions = {},
): Promise<PublishedEventsPage> {
  return pageOfEvents(
    eventsCol().where('orgId', '==', orgId).where('status', '==', 'published'),
    options,
  );
}

/**
 * Apply the shared public ordering, cursor, and page size to an already-filtered
 * event query.
 *
 * The explicit `__name__` ordering is the tie-breaker that makes the total order
 * stable — Firestore appends it to the index anyway, so naming it costs nothing
 * and lets the cursor address an exact position rather than a `startsAt` that
 * several events may share.
 */
async function pageOfEvents(
  filtered: Query<WorkshopEvent>,
  options: ListPublishedEventsOptions,
): Promise<PublishedEventsPage> {
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  let query = filtered
    .orderBy('startsAt', 'asc')
    .orderBy(FieldPath.documentId(), 'asc');

  if (options.cursor) {
    const cursor = decodeEventCursor(options.cursor);
    query = query.startAfter(
      Timestamp.fromMillis(cursor.startsAtMs),
      cursor.eventId,
    );
  }

  const snapshot = await query.limit(limit).get();
  const events = snapshot.docs.map(eventFromQueryDoc);
  const last = events[events.length - 1];

  return {
    events,
    // A full page means there may be more. A short page is definitively the
    // last one; a full final page costs one extra empty request.
    nextCursor:
      events.length === limit && last ? encodeEventCursor(last) : null,
  };
}

export interface ListOrgEventsOptions {
  limit?: number;
}

/**
 * Organizer dashboard: every event owned by one org, newest first, regardless
 * of status. Backed by the `events (orgId ASC, startsAt DESC)` index.
 */
export async function listOrgEvents(
  orgId: string,
  options: ListOrgEventsOptions = {},
): Promise<WorkshopEvent[]> {
  let query: Query<WorkshopEvent> = eventsCol()
    .where('orgId', '==', orgId)
    .orderBy('startsAt', 'desc');

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return (await query.get()).docs.map(eventFromQueryDoc);
}

export interface ListEventGuestsOptions {
  /** Restrict to one registration status; omit for all guests. */
  status?: GuestStatus;
  limit?: number;
}

/**
 * The guest list for one event, in registration order.
 *
 * Unfiltered this needs only the automatic single-field `registeredAt` index;
 * with `status` it is backed by the `guests (status ASC, registeredAt ASC)`
 * composite index.
 */
export async function listEventGuests(
  eventId: string,
  options: ListEventGuestsOptions = {},
): Promise<Guest[]> {
  let query: Query<Guest> = guestsCol(eventId);

  if (options.status !== undefined) {
    query = query.where('status', '==', options.status);
  }

  query = query.orderBy('registeredAt', 'asc');

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return (await query.get()).docs.map(guestFromQueryDoc);
}

/**
 * One guest by email. An O(1) `get()`, because the doc id is the normalized
 * email — `email` is normalized here so callers can pass raw user input.
 */
export async function getGuest(
  eventId: string,
  email: string,
): Promise<Guest | null> {
  return guestFrom(await guestRef(eventId, email).get());
}

/**
 * "Find my registrations" — every guest doc for one email across all events,
 * newest first.
 *
 * A collection-group query backed by the
 * `guests (email ASC, registeredAt DESC)` **COLLECTION_GROUP** index. It
 * matches on the `email` field, so it only finds registrations whose `email`
 * was stored normalized — which is the same rule that produced their doc ids.
 */
export async function findRegistrationsByEmail(
  email: string,
): Promise<Guest[]> {
  const snapshot = await guestsGroup()
    .where('email', '==', normalizeEmail(email))
    .orderBy('registeredAt', 'desc')
    .get();

  return snapshot.docs.map(guestFromQueryDoc);
}
