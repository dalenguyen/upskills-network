import type { Guest, WorkshopEvent } from '@upskills/models';
import type { CreateEventInput, UpdateEventInput } from '@upskills/validation';
import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, eventRef, eventsCol } from './collections';
import { listEventGuests } from './reads';
import {
  asSlugTaken,
  normalizeSlug,
  renameSlugInTransaction,
  reserveSlugInTransaction,
} from './slugs';
import { EventNotFoundError, runTransaction } from './transactions';

/**
 * The organizer's write paths for `events/{eventId}`.
 *
 * Every function follows the house transaction pattern from
 * `transactions.ts`: reads first, the decision from what the transaction read,
 * and one commit. Unlike the guest transitions, slug ownership is part of the
 * same commit as the event document — a create or rename must never leave an
 * event without its slug reservation, nor a slug reservation without its event.
 */

/** The cancelled event and the guests the caller must notify. */
export interface CancelEventResult {
  /** The event as stored after the cancellation. */
  event: WorkshopEvent;
  /** Guests who held a confirmed spot when the event was cancelled. */
  guests: Guest[];
}

/**
 * Create one event and reserve its slug, in one transaction.
 *
 * The event document and the `eventSlugs/{slug}` reservation commit together,
 * so a slug collision writes nothing and a crash after the commit cannot leave
 * an orphaned reservation.
 *
 * @throws InvalidSlugError when `input.slug` is not a legal slug.
 * @throws SlugTakenError when another event already holds the slug.
 */
export async function createEvent(
  orgId: string,
  input: CreateEventInput,
): Promise<WorkshopEvent> {
  const eventDoc = eventsCol().doc();
  const eventId = eventDoc.id;
  const createdAt = Timestamp.now();
  const slug = normalizeSlug(input.slug);

  return runTransaction(async (transaction) => {
    // The slug read and write happen first: the event document below has to
    // store the normalized slug this returns, so its write must come after.
    const reservedSlug = await reserveSlugInTransaction(
      transaction,
      COLLECTIONS.eventSlugs,
      slug,
      eventId,
    );

    const event: WorkshopEvent = {
      eventId,
      orgId,
      title: input.title,
      slug: reservedSlug,
      description: input.description,
      startsAt: Timestamp.fromDate(new Date(input.startsAt)),
      ...(input.endsAt === undefined
        ? {}
        : { endsAt: Timestamp.fromDate(new Date(input.endsAt)) }),
      timezone: input.timezone,
      ...(input.location === undefined ? {} : { location: input.location }),
      price: input.price,
      currency: input.currency,
      maxGuests: input.maxGuests,
      confirmedCount: 0,
      heldCount: 0,
      pendingCount: 0,
      status: input.status ?? 'draft',
      createdAt,
      updatedAt: createdAt,
    };

    transaction.create(eventDoc, event);
    return event;
  }).catch(asSlugTaken(COLLECTIONS.eventSlugs, slug));
}

/**
 * Apply a partial update to one event, in one transaction.
 *
 * `updatedAt` is always bumped. When `patch.slug` changes the slug, the old
 * `eventSlugs` reservation is released and the new one taken in the same
 * transaction as the event write — a rename is atomic with the event document
 * that advertises it.
 *
 * @throws EventNotFoundError when `eventId` names no event.
 * @throws InvalidSlugError when `patch.slug` is not a legal slug.
 * @throws SlugTakenError when another event already holds the new slug.
 */
export async function updateEvent(
  eventId: string,
  patch: UpdateEventInput,
): Promise<WorkshopEvent> {
  const eventDoc = eventRef(eventId);
  const updatedAt = Timestamp.now();
  const nextSlug =
    patch.slug === undefined ? undefined : normalizeSlug(patch.slug);

  const attempt = runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventDoc);
    const existing = snapshot.data();

    if (!existing) {
      throw new EventNotFoundError(eventId);
    }

    const current: WorkshopEvent = { ...existing, eventId: snapshot.id };

    let slug = current.slug;
    if (nextSlug !== undefined && nextSlug !== current.slug) {
      slug = await renameSlugInTransaction(
        transaction,
        COLLECTIONS.eventSlugs,
        eventId,
        { from: current.slug, to: nextSlug },
      );
    }

    const next: WorkshopEvent = {
      ...current,
      ...eventPatchFromInput(patch),
      slug,
      updatedAt,
    };

    transaction.set(eventDoc, next);
    return next;
  });

  return nextSlug === undefined
    ? attempt
    : attempt.catch(asSlugTaken(COLLECTIONS.eventSlugs, nextSlug));
}

/**
 * Cancel an event — the soft delete.
 *
 * The document is never removed: deleting it would orphan paid guest documents
 * and destroy the payment audit trail. Cancellation instead sets
 * `status: 'cancelled'` and returns the event alongside its confirmed guests,
 * so the caller can tell every person who held a seat that it is off.
 *
 * @throws EventNotFoundError when `eventId` names no event.
 */
export async function cancelEvent(
  eventId: string,
): Promise<CancelEventResult> {
  const eventDoc = eventRef(eventId);
  const updatedAt = Timestamp.now();

  const event = await runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventDoc);
    const existing = snapshot.data();

    if (!existing) {
      throw new EventNotFoundError(eventId);
    }

    const next: WorkshopEvent = {
      ...existing,
      eventId: snapshot.id,
      status: 'cancelled',
      updatedAt,
    };

    transaction.set(eventDoc, next);
    return next;
  });

  const guests = await listEventGuests(eventId, { status: 'confirmed' });

  return { event, guests };
}

/**
 * The caller-supplied patch, with ISO date strings converted to Firestore
 * `Timestamp`s. The schema already guarantees `endsAt >= startsAt`; conversion
 * is mechanical.
 */
function eventPatchFromInput(
  patch: UpdateEventInput,
): Partial<WorkshopEvent> {
  return {
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.description === undefined
      ? {}
      : { description: patch.description }),
    ...(patch.startsAt === undefined
      ? {}
      : { startsAt: Timestamp.fromDate(new Date(patch.startsAt)) }),
    ...(patch.endsAt === undefined
      ? {}
      : { endsAt: Timestamp.fromDate(new Date(patch.endsAt)) }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
    ...(patch.location === undefined ? {} : { location: patch.location }),
    ...(patch.price === undefined ? {} : { price: patch.price }),
    ...(patch.currency === undefined ? {} : { currency: patch.currency }),
    ...(patch.maxGuests === undefined ? {} : { maxGuests: patch.maxGuests }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
  };
}
