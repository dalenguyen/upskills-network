import type {
  Guest,
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
 * events/{eventId}
 *   └─ guests/{guestId}          # guestId = normalizeEmail(email)
 * orgSlugs/{slug}      → { orgId }
 * eventSlugs/{slug}    → { eventId }
 * stripeEvents/{stripeEventId}   # webhook idempotency ledger
 * waitlist/{normalizedEmail}     # landing-page waitlist signups
 * ```
 */
export const COLLECTIONS = {
  users: 'users',
  organizers: 'organizers',
  events: 'events',
  /** Subcollection of `events/{eventId}`. */
  guests: 'guests',
  orgSlugs: 'orgSlugs',
  eventSlugs: 'eventSlugs',
  stripeEvents: 'stripeEvents',
  waitlist: 'waitlist',
} as const;

/** `orgSlugs/{slug}` — the uniqueness reservation for an organizer slug. */
export interface OrgSlugReservation {
  orgId: string;
}

/** `eventSlugs/{slug}` — the uniqueness reservation for an event slug. */
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

export function eventsCol(): CollectionReference<WorkshopEvent> {
  return getDb().collection(COLLECTIONS.events).withConverter(eventConverter);
}

export function eventRef(eventId: string): DocumentReference<WorkshopEvent> {
  return eventsCol().doc(eventId);
}

export function guestsCol(eventId: string): CollectionReference<Guest> {
  return eventRef(eventId)
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
  eventId: string,
  email: string,
): DocumentReference<Guest> {
  return guestsCol(eventId).doc(normalizeEmail(email));
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

export function eventSlugRef(
  slug: string,
): DocumentReference<EventSlugReservation> {
  return getDb()
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
