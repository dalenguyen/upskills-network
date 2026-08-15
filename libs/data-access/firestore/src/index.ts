export { getDb } from './lib/db';

export {
  COLLECTIONS,
  eventRef,
  eventSlugRef,
  eventsCol,
  guestRef,
  guestsCol,
  guestsGroup,
  orgRef,
  orgSlugRef,
  orgsCol,
  stripeEventRef,
  userRef,
  usersCol,
  waitlistSubscriberRef,
  waitlistSubscribersCol,
} from './lib/collections';
export type {
  EventSlugReservation,
  OrgSlugReservation,
  StripeEventRecord,
} from './lib/collections';

export { decodeEventCursor, encodeEventCursor } from './lib/cursor';
export type { EventCursor } from './lib/cursor';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  findRegistrationsByEmail,
  getEvent,
  getEventBySlug,
  getGuest,
  getOrg,
  getOrgBySlug,
  getUser,
  listEventGuests,
  listOrgEvents,
  listPublishedEvents,
  listPublishedOrgEvents,
} from './lib/reads';
export type {
  ListEventGuestsOptions,
  ListOrgEventsOptions,
  ListPublishedEventsOptions,
  PublishedEventsPage,
} from './lib/reads';

export {
  EventNotFoundError,
  EventNotRegisterableError,
  MAX_RESTARTS,
  MAX_TRANSACTION_ATTEMPTS,
  PaymentRequiredError,
  TransactionContendedError,
  runIdempotentTransaction,
  runTransaction,
} from './lib/transactions';

export { createUserIfAbsent } from './lib/users';
export type { CreateUserResult } from './lib/users';

export { reserveSpot } from './lib/reserve-spot';
export type {
  GuestDraft,
  ReserveMode,
  ReserveOutcome,
  ReserveSpotResult,
} from './lib/reserve-spot';

export {
  InvalidSlugError,
  SlugTakenError,
  releaseSlug,
  renameSlug,
  reserveSlug,
} from './lib/slugs';
export type { SlugCollection, SlugRename, SlugReservation } from './lib/slugs';

export {
  isStripeEventProcessed,
  withStripeEventGuard,
} from './lib/stripe-events';
export type {
  StripeEventGuardOptions,
  StripeEventOutcome,
} from './lib/stripe-events';

export { addWaitlistSubscriber } from './lib/waitlist';
export type { WaitlistOutcome } from './lib/waitlist';

export {
  cancelGuest,
  confirmHeldGuest,
  promoteNextPending,
  releaseHold,
} from './lib/transitions';
export type {
  PaymentInfo,
  TransitionReason,
  TransitionResult,
} from './lib/transitions';

export { cancelEvent, createEvent, updateEvent } from './lib/events-write';
export type { CancelEventResult } from './lib/events-write';
