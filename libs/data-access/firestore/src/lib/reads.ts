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
  COLLECTIONS,
  eventRef,
  eventSlugRef,
  eventsCol,
  eventsGroup,
  guestRef,
  guestsCol,
  guestsGroup,
  orgRef,
  orgSlugRef,
  orgsCol,
  userRef,
  usersCol,
} from './collections';
import {
  decodeEventCursor,
  encodeEventCursor,
  type EventCursor,
} from './cursor';
import { getDb } from './db';

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

function orgFromQueryDoc(
  snapshot: QueryDocumentSnapshot<Organizer>,
): Organizer {
  return { ...snapshot.data(), orgId: snapshot.id };
}

function eventFrom(
  snapshot: DocumentSnapshot<WorkshopEvent>,
): WorkshopEvent | null {
  const data = snapshot.data();
  return data ? eventFromParts(snapshot, data) : null;
}

function eventFromQueryDoc(
  snapshot: QueryDocumentSnapshot<WorkshopEvent>,
): WorkshopEvent {
  return eventFromParts(snapshot, snapshot.data());
}

/**
 * Stamp the ids the *path* carries back onto the event.
 *
 * `organizers/{orgId}/events/{eventId}` — both ids are in the reference, so both
 * are taken from it rather than trusted from the body. This matters most for
 * {@link listPublishedEvents}, a collection-group query whose results come from
 * organizers the caller never named: `orgId` is the only way the browse page can
 * build a `/{orgSlug}/{eventSlug}` link, and reading it from the path means a
 * document with a stale or missing `orgId` field still resolves correctly.
 */
function eventFromParts(
  snapshot: DocumentSnapshot<WorkshopEvent>,
  data: WorkshopEvent,
): WorkshopEvent {
  return {
    ...data,
    eventId: snapshot.id,
    orgId: snapshot.ref.parent.parent?.id ?? data.orgId,
  };
}

function guestFromQueryDoc(snapshot: QueryDocumentSnapshot<Guest>): Guest {
  const data = snapshot.data();
  const event = snapshot.ref.parent.parent;

  return {
    ...data,
    guestId: snapshot.id,
    // `organizers/{orgId}/events/{eventId}/guests/{guestId}` — the path is
    // authoritative, which matters for collection-group hits where the caller
    // named neither the event nor the organizer.
    eventId: event?.id ?? data.eventId,
    orgId: event?.parent.parent?.id ?? data.orgId,
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

/**
 * Raised when one email address maps to more than one account.
 *
 * Nothing enforces uniqueness of `users/{uid}.email` — two providers can hand
 * the same address to two accounts — and this lookup is what turns "add
 * grace@example.com as a manager" into a uid that gets the role. Picking one of
 * the matches would silently grant access to whichever document sorted first,
 * so an ambiguous address is refused and the caller is told to disambiguate by
 * uid instead.
 */
export class AmbiguousUserEmailError extends Error {
  constructor(readonly email: string) {
    super(`More than one account uses the email "${email}".`);
    this.name = 'AmbiguousUserEmailError';
  }
}

/**
 * The one user with this email, or `null`.
 *
 * `users/{uid}.email` is written normalized (`user-upsert.ts`), so the lookup
 * normalizes too — otherwise `Ada@Example.com` would miss the document it
 * created. Backed by the automatic single-field index on `email`; no composite
 * index is required.
 *
 * Reads two documents to answer a question about one: the second is there only
 * to notice a duplicate. See {@link AmbiguousUserEmailError} for why a duplicate
 * is refused rather than resolved.
 *
 * @throws AmbiguousUserEmailError when two accounts share the address.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  const snapshot = await usersCol()
    .where('email', '==', normalized)
    .limit(2)
    .get();

  if (snapshot.size > 1) {
    throw new AmbiguousUserEmailError(normalized);
  }

  const doc = snapshot.docs[0];

  return doc ? { ...doc.data(), uid: doc.id } : null;
}

/**
 * Email for each of `uids`, keyed by uid — the roster's "who is this?" lookup.
 *
 * One `getAll` rather than N gets, and uids with no `users/{uid}` document are
 * simply absent from the result: a membership can outlive the account it names,
 * and the caller renders what it has.
 */
export async function getUserEmails(
  uids: string[],
): Promise<Record<string, string>> {
  if (uids.length === 0) {
    return {};
  }

  const snapshots = await getDb().getAll(...uids.map((uid) => userRef(uid)));
  const emails: Record<string, string> = {};

  for (const snapshot of snapshots) {
    const email = (snapshot.data() as User | undefined)?.email;

    if (email !== undefined && email !== '') {
      emails[snapshot.id] = email;
    }
  }

  return emails;
}

/** `organizers/{orgId}` */
export async function getOrg(orgId: string): Promise<Organizer | null> {
  return orgFrom(await orgRef(orgId).get());
}

/**
 * Every organizer, oldest first.
 *
 * Backed by the automatic single-field `createdAt` index; no composite index is
 * required because there is no equality filter before the ordering.
 */
export async function listOrgs(): Promise<Organizer[]> {
  return (await orgsCol().orderBy('createdAt', 'asc').get()).docs.map(
    orgFromQueryDoc,
  );
}

/**
 * Slug for each of `orgIds`, keyed by orgId — the browse listing's "how do I
 * link to this?" lookup.
 *
 * A public event URL is `/{orgSlug}/{eventSlug}`, and {@link listPublishedEvents}
 * returns events from organizers the caller never named. The alternative would
 * be denormalizing `orgSlug` onto every event document, which turns renaming an
 * organizer into a fan-out write across their whole back catalogue — and leaves
 * every event carrying a slug that can silently go stale.
 *
 * One `getAll` for the whole page, deduplicated by the caller: a page of twenty
 * events from three organizers costs three reads, not twenty. Organizers with no
 * document are simply absent from the result.
 */
export async function getOrgSlugs(
  orgIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(orgIds)];

  if (unique.length === 0) {
    return {};
  }

  const snapshots = await getDb().getAll(...unique.map((id) => orgRef(id)));
  const slugs: Record<string, string> = {};

  for (const snapshot of snapshots) {
    const slug = (snapshot.data() as Organizer | undefined)?.slug;

    if (slug !== undefined && slug !== '') {
      slugs[snapshot.id] = slug;
    }
  }

  return slugs;
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

/** `organizers/{orgId}/events/{eventId}` */
export async function getEvent(
  orgId: string,
  eventId: string,
): Promise<WorkshopEvent | null> {
  return eventFrom(await eventRef(orgId, eventId).get());
}

/** What `/{orgSlug}/{eventSlug}` resolves to: both documents behind the URL. */
export interface EventPage {
  organizer: Organizer;
  event: WorkshopEvent;
}

/**
 * The public event page's lookup: `/{orgSlug}/{eventSlug}` → both documents.
 *
 * Three key reads in two round trips, all `get()`s on document ids — never a
 * `where('slug', '==', …)`:
 *
 * 1. `orgSlugs/{orgSlug}` → `orgId`.
 * 2. In parallel, `organizers/{orgId}` and
 *    `organizers/{orgId}/eventSlugs/{eventSlug}` → the organizer and `eventId`.
 * 3. `organizers/{orgId}/events/{eventId}`.
 *
 * The organizer is fetched alongside the reservation rather than after it
 * because the page renders the organizer's name either way — a lookup that
 * returned only the event would just make its caller pay for a fourth read.
 *
 * Returns `null` if any link in the chain is missing. A reservation pointing at
 * a deleted event is a data problem, not a caller problem, and reads the same as
 * a URL nobody ever published.
 */
export async function getEventByPath(
  orgSlug: string,
  eventSlug: string,
): Promise<EventPage | null> {
  const orgReservation = (await orgSlugRef(orgSlug).get()).data();
  if (!orgReservation) {
    return null;
  }

  const { orgId } = orgReservation;
  const [organizer, eventReservation] = await Promise.all([
    getOrg(orgId),
    eventSlugRef(orgId, eventSlug)
      .get()
      .then((snapshot) => snapshot.data()),
  ]);

  if (!organizer || !eventReservation) {
    return null;
  }

  const event = await getEvent(orgId, eventReservation.eventId);
  return event ? { organizer, event } : null;
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
 * time.
 *
 * The one read that genuinely spans organizers, so the one that pays for the
 * subcollection: a **collection-group** query backed by the
 * `events (status ASC, startsAt ASC)` **COLLECTION_GROUP** index. Same fields as
 * the top-level index it replaced — only the scope changed.
 */
export async function listPublishedEvents(
  options: ListPublishedEventsOptions = {},
): Promise<PublishedEventsPage> {
  return pageOfEvents(
    eventsGroup().where('status', '==', 'published'),
    options,
    'group',
  );
}

/**
 * The public organizer page: one org's published events, soonest first.
 *
 * Reads `organizers/{orgId}/events` directly, so the organizer is the path
 * rather than an equality filter. Backed by the **COLLECTION**-scoped
 * `events (status ASC, startsAt ASC)` index.
 *
 * That is a second declaration with the same fields as the COLLECTION_GROUP one
 * {@link listPublishedEvents} uses, and both are required: Firestore treats the
 * two scopes as different indexes, and a collection-group index does not serve a
 * query against a single collection. `firestore.indexes.json` declares each.
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
    eventsCol(orgId).where('status', '==', 'published'),
    options,
    'collection',
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
/**
 * Which form of query a page is being read from — they take different
 * `__name__` cursor values. See {@link documentIdCursor}.
 */
type EventQueryScope = 'collection' | 'group';

/**
 * The `__name__` value for a cursor, in the form its query will accept.
 *
 * A query over one collection takes a bare document id. A **collection-group**
 * query does not: Firestore rejects anything that is not a full document path
 * ("must result in a valid document path, but 'evt-1' … contains an odd number
 * of segments"), because an id alone is ambiguous across the organizers the
 * group spans. This is the one place the two query shapes genuinely differ, and
 * getting it wrong fails only on the *second* page — which is why the paging
 * tests are the ones that catch it.
 */
function documentIdCursor(cursor: EventCursor, scope: EventQueryScope): string {
  return scope === 'group'
    ? `${COLLECTIONS.organizers}/${cursor.orgId}/${COLLECTIONS.events}/${cursor.eventId}`
    : cursor.eventId;
}

async function pageOfEvents(
  filtered: Query<WorkshopEvent>,
  options: ListPublishedEventsOptions,
  scope: EventQueryScope,
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
      documentIdCursor(cursor, scope),
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
 * of status.
 *
 * Now a plain read of `organizers/{orgId}/events` with no filter at all —
 * ownership is the path. That also means **no composite index**: a single
 * `orderBy` on a collection is served by the automatic single-field index, so
 * the `(orgId ASC, startsAt DESC)` declaration this query used to need is gone.
 */
export async function listOrgEvents(
  orgId: string,
  options: ListOrgEventsOptions = {},
): Promise<WorkshopEvent[]> {
  let query: Query<WorkshopEvent> = eventsCol(orgId).orderBy(
    'startsAt',
    'desc',
  );

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return (await query.get()).docs.map(eventFromQueryDoc);
}

/**
 * Every event in the database, across every organizer and every status.
 *
 * The media sweep is the only caller and it needs exactly this: an object in
 * the bucket is garbage only if *no* event anywhere still points at it, so a
 * read that misses any event would delete a live image. Draft and cancelled
 * events are included deliberately — both still carry an `imageUrl` and a
 * cancelled event's page still renders it.
 *
 * A collection-group query with no filter and no ordering, so it needs **no
 * composite index**; the unfiltered group scan is served automatically.
 *
 * Deliberately unpaginated. The sweep has to hold the whole referenced set in
 * memory anyway to answer "is this path referenced", so paging would add a
 * cursor without lowering the peak. If the event count ever outgrows one
 * request, the sweep needs redesigning around a per-org pass rather than this
 * read growing a page size.
 */
export async function listAllEvents(): Promise<WorkshopEvent[]> {
  return (await eventsGroup().get()).docs.map(eventFromQueryDoc);
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
  orgId: string,
  eventId: string,
  options: ListEventGuestsOptions = {},
): Promise<Guest[]> {
  let query: Query<Guest> = guestsCol(orgId, eventId);

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
  orgId: string,
  eventId: string,
  email: string,
): Promise<Guest | null> {
  return guestFrom(await guestRef(orgId, eventId, email).get());
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
