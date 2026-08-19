export { getDb } from './lib/db';

export {
  COLLECTIONS,
  eventRef,
  eventSlugRef,
  eventsCol,
  guestRef,
  guestsCol,
  guestsGroup,
  orgInviteRef,
  orgInvitesCol,
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
  AmbiguousUserEmailError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  findRegistrationsByEmail,
  findUserByEmail,
  getEvent,
  getEventByPath,
  getGuest,
  getOrg,
  getOrgBySlug,
  getOrgSlugs,
  getUser,
  getUserEmails,
  listEventGuests,
  listOrgEvents,
  listOrgs,
  listPublishedEvents,
  listPublishedOrgEvents,
} from './lib/reads';
export type {
  EventPage,
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

export {
  LastOrgAdminError,
  OrgLimitExceededError,
  OrgNotEmptyError,
  OrgNotFoundError,
  createOrg,
  deleteOrg,
  removeOrgMember,
  setOrgMember,
} from './lib/orgs';
export type { CreateOrgDraft } from './lib/orgs';

export {
  INVITE_TTL_DAYS,
  InviteEmailMismatchError,
  InviteNotFoundError,
  InviteNotPendingError,
  acceptOrgInvite,
  createOrgInvite,
  findOrgInviteByToken,
  getOrgInvite,
  listOrgInvites,
  orgInviteStatus,
  revokeOrgInvite,
} from './lib/invites';
export type {
  AcceptOrgInviteOptions,
  AcceptOrgInviteResult,
  CreateOrgInviteDraft,
} from './lib/invites';

export { reserveSpot } from './lib/reserve-spot';
export type {
  GuestDraft,
  ReserveMode,
  ReserveOutcome,
  ReserveSpotResult,
} from './lib/reserve-spot';

export {
  InvalidSlugError,
  ORG_SLUGS,
  SlugTakenError,
  asSlugTaken,
  eventSlugsOf,
  releaseSlug,
  releaseSlugInTransaction,
  renameSlug,
  renameSlugInTransaction,
  reserveSlug,
  reserveSlugInTransaction,
} from './lib/slugs';
export type { SlugRename, SlugReservation, SlugTarget } from './lib/slugs';

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

export {
  EventNotDeletableError,
  cancelEvent,
  createEvent,
  deleteDraftEvent,
  updateEvent,
} from './lib/events-write';
export type {
  CancelEventResult,
  CreateEventDraft,
  UpdateEventPatch,
} from './lib/events-write';
