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
  userRef,
  usersCol,
} from './lib/collections';
export type {
  EventSlugReservation,
  OrgSlugReservation,
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
} from './lib/reads';
export type {
  ListEventGuestsOptions,
  ListOrgEventsOptions,
  ListPublishedEventsOptions,
  PublishedEventsPage,
} from './lib/reads';
