import type {
  Guest,
  OrgInvite,
  Organizer,
  Timestamp,
  User,
  WaitlistSubscriber,
  WorkshopEvent,
} from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';
import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  FirestoreDataConverter,
  PartialWithFieldValue,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { getDb } from './db';

/**
 * Every collection this app touches, in one place.
 *
 * ```
 * users/{uid}
 * organizers/{orgId}
 *   ├─ events/{eventId}
 *   │    └─ guests/{guestId}     # guestId = normalizeEmail(email)
 *   └─ eventSlugs/{slug}  → { eventId }
 * orgInvites/{inviteId}          # pending staff invitations
 * orgSlugs/{slug}       → { orgId }
 * stripeEvents/{stripeEventId}   # webhook idempotency ledger
 * waitlist/{normalizedEmail}     # landing-page waitlist signups
 * ```
 *
 * ## Why events hang off the organizer
 *
 * Ownership is the path. An event cannot be written into the wrong org without
 * addressing a different collection, "every event this org owns" is a plain
 * collection read with no filter, and — the reason the slug work started —
 * `eventSlugs` becomes a subcollection too, so `react-basics` is claimable once
 * *per organizer* rather than once across the whole product.
 *
 * The price is that anything reading across orgs must use a collection-group
 * query ({@link eventsGroup}) with a COLLECTION_GROUP index behind it. Two
 * queries pay it: the public browse and the reminder sweep.
 */
export const COLLECTIONS = {
  users: 'users',
  organizers: 'organizers',
  orgInvites: 'orgInvites',
  /** Subcollection of `organizers/{orgId}`. */
  events: 'events',
  /** Subcollection of `organizers/{orgId}/events/{eventId}`. */
  guests: 'guests',
  orgSlugs: 'orgSlugs',
  /** Subcollection of `organizers/{orgId}`. */
  eventSlugs: 'eventSlugs',
  stripeEvents: 'stripeEvents',
  waitlist: 'waitlist',
} as const;

/** `orgSlugs/{slug}` — the uniqueness reservation for an organizer slug. */
export interface OrgSlugReservation {
  orgId: string;
}

/**
 * `organizers/{orgId}/eventSlugs/{slug}` — the uniqueness reservation for an
 * event slug, scoped to one organizer.
 *
 * No `orgId` field: the organizer is the document's grandparent, so storing it
 * would be a second copy of the path that could disagree with it.
 */
export interface EventSlugReservation {
  eventId: string;
}

/**
 * `stripeEvents/{stripeEventId}` — the webhook idempotency ledger.
 *
 * The document id is Stripe's own event id, so "have we handled this delivery?"
 * is the existence of a key rather than a query. Its body exists only for
 * humans reading the ledger during an incident.
 */
export interface StripeEventRecord {
  /** Stripe's `evt_…` id — the same value as the document id. */
  stripeEventId: string;
  /** Stripe's event type, e.g. `checkout.session.completed`. */
  type?: string;
  processedAt: Timestamp;
}

/**
 * A converter that only carries the type: Firestore data already matches the
 * model shape, so there is nothing to map. Its whole job is to make refs and
 * queries generic in the model type, so `snap.data()` is typed at every call
 * site instead of each one writing its own `as` cast.
 *
 * Reads still go through the `fromSnapshot` helpers in `reads.ts`, which
 * additionally stamp the doc id onto the model.
 */
function typedConverter<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (model: PartialWithFieldValue<T>) =>
      model as unknown as DocumentData,
    fromFirestore: (snapshot: QueryDocumentSnapshot) =>
      snapshot.data() as unknown as T,
  };
}

const userConverter = typedConverter<User>();
const orgConverter = typedConverter<Organizer>();
const orgInviteConverter = typedConverter<OrgInvite>();
const eventConverter = typedConverter<WorkshopEvent>();
const guestConverter = typedConverter<Guest>();
const orgSlugConverter = typedConverter<OrgSlugReservation>();
const eventSlugConverter = typedConverter<EventSlugReservation>();
const stripeEventConverter = typedConverter<StripeEventRecord>();
const waitlistSubscriberConverter = typedConverter<WaitlistSubscriber>();

export function usersCol(): CollectionReference<User> {
  return getDb().collection(COLLECTIONS.users).withConverter(userConverter);
}

export function userRef(uid: string): DocumentReference<User> {
  return usersCol().doc(uid);
}

export function orgsCol(): CollectionReference<Organizer> {
  return getDb().collection(COLLECTIONS.organizers).withConverter(orgConverter);
}

export function orgRef(orgId: string): DocumentReference<Organizer> {
  return orgsCol().doc(orgId);
}

export function orgInvitesCol(): CollectionReference<OrgInvite> {
  return getDb()
    .collection(COLLECTIONS.orgInvites)
    .withConverter(orgInviteConverter);
}

export function orgInviteRef(inviteId: string): DocumentReference<OrgInvite> {
  return orgInvitesCol().doc(inviteId);
}

/** `organizers/{orgId}/events` — one organizer's events. */
export function eventsCol(orgId: string): CollectionReference<WorkshopEvent> {
  return orgRef(orgId)
    .collection(COLLECTIONS.events)
    .withConverter(eventConverter);
}

export function eventRef(
  orgId: string,
  eventId: string,
): DocumentReference<WorkshopEvent> {
  return eventsCol(orgId).doc(eventId);
}

/**
 * Every event doc across every organizer — for the two queries that genuinely
 * span orgs: the public browse and the reminder sweep.
 *
 * Needs a **COLLECTION_GROUP** index for anything beyond a single equality
 * filter; see `firestore.indexes.json`. Reach for {@link eventsCol} instead
 * whenever the organizer is known — a scoped read needs no such index and
 * cannot accidentally return somebody else's event.
 */
export function eventsGroup(): Query<WorkshopEvent> {
  return getDb()
    .collectionGroup(COLLECTIONS.events)
    .withConverter(eventConverter);
}

export function guestsCol(
  orgId: string,
  eventId: string,
): CollectionReference<Guest> {
  return eventRef(orgId, eventId)
    .collection(COLLECTIONS.guests)
    .withConverter(guestConverter);
}

/**
 * The guest doc for one email on one event.
 *
 * The doc id **is** `normalizeEmail(email)` — that is what makes double
 * registration impossible without a query. Never build this path by hand.
 */
export function guestRef(
  orgId: string,
  eventId: string,
  email: string,
): DocumentReference<Guest> {
  return guestsCol(orgId, eventId).doc(normalizeEmail(email));
}

/** Every guest doc across every event — for the cross-event email lookup. */
export function guestsGroup(): Query<Guest> {
  return getDb()
    .collectionGroup(COLLECTIONS.guests)
    .withConverter(guestConverter);
}

export function orgSlugRef(
  slug: string,
): DocumentReference<OrgSlugReservation> {
  return getDb()
    .collection(COLLECTIONS.orgSlugs)
    .withConverter(orgSlugConverter)
    .doc(slug);
}

/**
 * `organizers/{orgId}/eventSlugs/{slug}` — an event slug reservation, scoped to
 * the organizer that holds it.
 *
 * The `orgId` argument is what makes event slugs per-org: the same `slug` under
 * two different organizers is two different documents, and neither collides.
 */
export function eventSlugRef(
  orgId: string,
  slug: string,
): DocumentReference<EventSlugReservation> {
  return orgRef(orgId)
    .collection(COLLECTIONS.eventSlugs)
    .withConverter(eventSlugConverter)
    .doc(slug);
}

/** `stripeEvents/{stripeEventId}` — one ledger entry per handled webhook. */
export function stripeEventRef(
  stripeEventId: string,
): DocumentReference<StripeEventRecord> {
  return getDb()
    .collection(COLLECTIONS.stripeEvents)
    .withConverter(stripeEventConverter)
    .doc(stripeEventId);
}

export function waitlistSubscribersCol(): CollectionReference<WaitlistSubscriber> {
  return getDb()
    .collection(COLLECTIONS.waitlist)
    .withConverter(waitlistSubscriberConverter);
}

/**
 * The waitlist doc for one email.
 *
 * The doc id **is** `normalizeEmail(email)` — the same convention as
 * {@link guestRef}, which is what makes a duplicate signup impossible without a
 * query. Never build this path by hand.
 */
export function waitlistSubscriberRef(
  email: string,
): DocumentReference<WaitlistSubscriber> {
  return waitlistSubscribersCol().doc(normalizeEmail(email));
}
