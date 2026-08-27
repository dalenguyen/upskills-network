import type { EventStatus, Guest, WorkshopEvent } from '@upskills/models';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { eventRef, eventsCol, guestsCol } from './collections';
import { listEventGuests } from './reads';
import {
  asSlugTaken,
  eventSlugsOf,
  releaseSlugInTransaction,
  renameSlugInTransaction,
  reserveSlugInTransaction,
} from './slugs';
import { EventNotFoundError, runTransaction } from './transactions';

/**
 * Event document writes.
 *
 * Every function follows the house transaction pattern: one
 * {@link runTransaction}, every read before any write, and the decision made
 * from what the transaction itself read. `createEvent` and `updateEvent` also
 * compose slug reservations with the event document write in the same commit,
 * so a taken slug leaves no event document behind and a failed event write
 * leaves no dangling slug reservation.
 */

/** The caller-supplied half of a new event document. */
export interface CreateEventDraft {
  title: string;
  /** Raw user input; normalized by the slug reservation, so callers never pre-process it. */
  slug: string;
  /** uid of the creator, from the authenticated session rather than the body. */
  createdBy: string;
  description: string;
  /** ISO-8601 with offset; converted to a Firestore `Timestamp` here. */
  startsAt: string;
  endsAt?: string;
  timezone: string;
  location?: string;
  /**
   * Marks the event as listed-only: registration is refused and the page sends
   * people here instead. Set by the community-events seed script; there is no
   * form that produces it.
   */
  externalUrl?: string;
  /** Whose listing `externalUrl` points at, e.g. `'Meetup'`. */
  sourceName?: string;
  /** Hero image, absolute https URL. */
  imageUrl?: string;
  /** The source published a date but no time of day — see the model field. */
  startTimeTbd?: boolean;
  /** Price in **minor units** (cents). `0` means free. */
  price: number;
  currency: WorkshopEvent['currency'];
  /** Capacity. `0` means unlimited. */
  maxGuests: number;
  /** Defaults to `'draft'`; `'cancelled'` is not a creation state. */
  status?: 'draft' | 'published';
}

/**
 * The caller-supplied half of an event update.
 *
 * `orgId`, `eventId`, `createdBy`, the counters, and the timestamps are
 * deliberately absent: the first two come from the path, `createdBy` is set at
 * creation and never edited, and the rest are maintained here.
 */
export interface UpdateEventPatch {
  title?: string;
  /** Raw user input; normalized by the slug reservation. */
  slug?: string;
  description?: string;
  /** ISO-8601 with offset; converted to a Firestore `Timestamp` here. */
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  location?: string;
  /**
   * Present so the seed script can re-point a listing whose source URL moved.
   * Passing an empty string clears it, which turns a listed event back into a
   * registerable one — the seed script never does that, but the field behaves
   * like `location` rather than growing a special case.
   */
  externalUrl?: string;
  sourceName?: string;
  imageUrl?: string;
  /** See the model field. `false` removes the flag rather than storing it. */
  startTimeTbd?: boolean;
  price?: number;
  currency?: WorkshopEvent['currency'];
  maxGuests?: number;
  /**
   * Draft/publish transitions only — **not** `'cancelled'`.
   *
   * Cancelling has to go through {@link cancelEvent}, which is the only path
   * that returns the confirmed guests. Allowing `'cancelled'` here would let a
   * route soft-delete an event and silently skip notifying everyone who had a
   * seat, with nothing in the type system objecting.
   */
  status?: Exclude<EventStatus, 'cancelled'>;
}

/** The soft-deleted event plus the guests the caller should notify. */
export interface CancelEventResult {
  event: WorkshopEvent;
  confirmedGuests: Guest[];
}

/**
 * Create an event and its slug reservation in one transaction.
 *
 * `createdAt` and `updatedAt` are generated once, outside the transaction, so
 * a retry cannot rewrite a different timestamp. The three capacity counters
 * start at zero because no guest has registered against a document that does
 * not exist yet.
 *
 * @returns the created event, with its generated `eventId`.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 * @throws SlugTakenError when another event already holds the slug.
 */
export async function createEvent(
  orgId: string,
  input: CreateEventDraft,
): Promise<WorkshopEvent> {
  const doc = eventsCol(orgId).doc();
  const createdAt = Timestamp.now();
  // Read in the catch handler, at rejection time, rather than when the catch is
  // built: the transaction body assigns this to the normalized slug before the
  // commit can fail with ALREADY_EXISTS.
  let reservedSlug = input.slug;

  return runTransaction(async (transaction) => {
    reservedSlug = await reserveSlugInTransaction(
      transaction,
      eventSlugsOf(orgId),
      input.slug,
      doc.id,
    );

    const event: WorkshopEvent = {
      eventId: doc.id,
      orgId,
      createdBy: input.createdBy,
      title: input.title.trim(),
      slug: reservedSlug,
      description: input.description.trim(),
      startsAt: toTimestamp(input.startsAt),
      ...(input.endsAt ? { endsAt: toTimestamp(input.endsAt) } : {}),
      timezone: input.timezone.trim(),
      ...(input.location !== undefined
        ? { location: input.location.trim() }
        : {}),
      ...(input.externalUrl !== undefined
        ? { externalUrl: input.externalUrl.trim() }
        : {}),
      // Only alongside the URL it describes — see the matching rule in
      // `updateEvent`. A source name with nothing to name is not a partial
      // record, it is a wrong one.
      ...(input.externalUrl !== undefined && input.sourceName !== undefined
        ? { sourceName: input.sourceName.trim() }
        : {}),
      ...(input.imageUrl !== undefined
        ? { imageUrl: input.imageUrl.trim() }
        : {}),
      // Only stored when true. `false` and absent mean the same thing — the
      // start time is known — so writing the `false` would add a field that
      // every event without a time question would carry for nothing.
      ...(input.startTimeTbd ? { startTimeTbd: true } : {}),
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

    // `create`, never `set`: the reservation read is what serializes
    // concurrent creates, and this is the backstop underneath it. A generated
    // event id cannot already exist, but if it somehow does the write fails
    // rather than overwriting a live event.
    transaction.create(doc, event);

    return event;
  }).catch((error: unknown) =>
    asSlugTaken(eventSlugsOf(orgId), reservedSlug)(error),
  );
}

/**
 * Update an event, always bumping `updatedAt`.
 *
 * A slug change is a {@link renameSlugInTransaction} on the transaction that
 * also writes the event document, so the old reservation is released and the
 * new one taken **in the same commit** as the document write. A collision on
 * the new slug aborts the whole transaction: the event keeps its original slug
 * and no half-applied rename is left behind.
 *
 * @returns the updated event.
 * @throws EventNotFoundError when `eventId` names no event.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 * @throws SlugTakenError when another event already holds the new slug.
 */
export async function updateEvent(
  orgId: string,
  eventId: string,
  patch: UpdateEventPatch,
): Promise<WorkshopEvent> {
  const updatedAt = Timestamp.now();
  let reservedSlug = patch.slug ?? '';

  return runTransaction(async (transaction) => {
    const doc = eventRef(orgId, eventId);
    const existing = eventFromSnapshot(await transaction.get(doc));
    if (!existing) {
      throw new EventNotFoundError(eventId);
    }

    let slug = existing.slug;
    if (patch.slug !== undefined) {
      slug = await renameSlugInTransaction(
        transaction,
        eventSlugsOf(orgId),
        eventId,
        { from: existing.slug, to: patch.slug },
      );
      reservedSlug = slug;
    }

    const next: WorkshopEvent = { ...existing, slug, updatedAt };

    if (patch.title !== undefined) {
      next.title = patch.title.trim();
    }
    if (patch.description !== undefined) {
      next.description = patch.description.trim();
    }
    if (patch.startsAt !== undefined) {
      next.startsAt = toTimestamp(patch.startsAt);
    }
    if (Object.hasOwn(patch, 'endsAt')) {
      if (patch.endsAt) {
        next.endsAt = toTimestamp(patch.endsAt);
      } else {
        delete next.endsAt;
      }
    }
    if (patch.timezone !== undefined) {
      next.timezone = patch.timezone.trim();
    }
    applyOptionalText(next, patch, 'location');
    applyOptionalText(next, patch, 'externalUrl');
    applyOptionalText(next, patch, 'sourceName');
    applyOptionalText(next, patch, 'imageUrl');

    // `heroImage` describes the bytes behind `imageUrl`, so it cannot outlive
    // the URL it was written for. Patching the URL — to a pasted link or to
    // nothing — makes the stored bookkeeping describe an object the event no
    // longer shows, which is both a lie and an orphan: the sweeper would see a
    // referenced path and leave the real garbage alone.
    //
    // Dropped rather than rewritten because this path cannot produce a
    // replacement: uploading from the edit form, and deleting the object the
    // old bookkeeping points at, is a separate change.
    if (Object.hasOwn(patch, 'imageUrl')) {
      delete next.heroImage;
    }

    // `sourceName` answers "whose listing is `externalUrl`?", so it cannot
    // outlive the field it describes. Clearing the URL without clearing the
    // name would leave an event that takes registrations here while still
    // publishing "Meetup" as its source — not rendered today, because the card
    // gates the badge on `externalUrl`, but the projection ships the field on
    // its own and the next reader of it would have no reason to distrust it.
    // Enforced here rather than at the caller: this is the only write path.
    if (next.externalUrl === undefined) {
      delete next.sourceName;
    }

    // Absent means "the time is known", so a `false` is a removal rather than
    // a value to store — the same rule the optional text fields follow.
    if (Object.hasOwn(patch, 'startTimeTbd')) {
      if (patch.startTimeTbd) {
        next.startTimeTbd = true;
      } else {
        delete next.startTimeTbd;
      }
    }

    if (patch.price !== undefined) {
      next.price = patch.price;
    }
    if (patch.currency !== undefined) {
      next.currency = patch.currency;
    }
    if (patch.maxGuests !== undefined) {
      next.maxGuests = patch.maxGuests;
    }
    if (patch.status !== undefined) {
      next.status = patch.status;
    }

    transaction.set(doc, next);
    return next;
  }).catch((error: unknown) =>
    asSlugTaken(eventSlugsOf(orgId), reservedSlug)(error),
  );
}

/**
 * Soft-delete an event: set `status: 'cancelled'` and return the event with
 * its confirmed guests so the caller can notify them.
 *
 * There is deliberately no hard delete. Deleting the document would orphan
 * paid guests and destroy the payment audit trail; a cancelled event keeps
 * every guest document and counter exactly as they were.
 *
 * @returns the cancelled event and the guests who need to be told.
 * @throws EventNotFoundError when `eventId` names no event.
 */
export async function cancelEvent(
  orgId: string,
  eventId: string,
): Promise<CancelEventResult> {
  const updatedAt = Timestamp.now();

  const event = await runTransaction(async (transaction) => {
    const doc = eventRef(orgId, eventId);
    const existing = eventFromSnapshot(await transaction.get(doc));
    if (!existing) {
      throw new EventNotFoundError(eventId);
    }

    const next: WorkshopEvent = {
      ...existing,
      status: 'cancelled',
      updatedAt,
    };

    transaction.set(doc, next);
    return next;
  });

  const confirmedGuests = await listEventGuests(orgId, eventId, {
    status: 'confirmed',
  });

  return { event, confirmedGuests };
}

/**
 * Raised when a hard delete is refused because the event is not a throwaway.
 *
 * Deleting an event that anybody registered for would orphan their guest
 * documents and destroy the payment audit trail — the same reason
 * {@link cancelEvent} is a soft delete. This error is what keeps the narrow
 * hard-delete path narrow.
 *
 * A route maps this to **409**.
 */
export class EventNotDeletableError extends Error {
  constructor(
    readonly eventId: string,
    /** `'not-draft'` or `'has-guests'` — which rule refused. */
    readonly reason: 'not-draft' | 'has-guests',
  ) {
    super(`Event "${eventId}" cannot be deleted: ${reason}.`);
    this.name = 'EventNotDeletableError';
  }
}

/**
 * Hard-delete a **draft** event nobody has registered for, releasing its slug.
 *
 * This is the "I typed the title wrong, make it go away" path, and it is
 * deliberately the only hard delete there is. Everything else goes through
 * {@link cancelEvent}: once an event has been published and taken registrations,
 * the document is a record, and the honest way to withdraw it is to cancel it
 * and tell the guests.
 *
 * Both refusals are checked against what *this transaction* read, not against
 * what the caller believed. Reading the guest query inside the transaction is
 * also what makes the check safe under concurrency: a registration landing
 * between the check and the commit joins the read set and forces a retry, which
 * then sees the guest and refuses. Checking first and deleting afterwards would
 * race a guest into an event that no longer exists.
 *
 * The slug reservation is released in the same commit, so the name is free the
 * instant the event is gone — and stays taken if the delete is refused.
 *
 * @throws EventNotFoundError when `eventId` names no event.
 * @throws EventNotDeletableError when the event is published/cancelled, or has
 *   any guest document at all — including cancelled and expired ones.
 */
export async function deleteDraftEvent(
  orgId: string,
  eventId: string,
): Promise<void> {
  return runTransaction(async (transaction) => {
    const doc = eventRef(orgId, eventId);

    // Every read before any write. The guest probe is `limit(1)`: the question
    // is "has anybody ever registered?", and one document answers it.
    const existing = eventFromSnapshot(await transaction.get(doc));
    if (!existing) {
      throw new EventNotFoundError(eventId);
    }

    const anyGuest = await transaction.get(guestsCol(orgId, eventId).limit(1));

    if (existing.status !== 'draft') {
      throw new EventNotDeletableError(eventId, 'not-draft');
    }

    if (!anyGuest.empty) {
      throw new EventNotDeletableError(eventId, 'has-guests');
    }

    await releaseSlugInTransaction(
      transaction,
      eventSlugsOf(orgId),
      existing.slug,
      eventId,
    );

    transaction.delete(doc);
  });
}

/** The optional free-text fields that all share one update rule. */
type OptionalTextField = 'location' | 'externalUrl' | 'sourceName' | 'imageUrl';

/**
 * Apply one optional string field from a patch, treating "" as "remove it".
 *
 * The three-way distinction matters and is easy to get wrong: **absent** from
 * the patch means leave it alone, a **non-empty** value means set it, and an
 * **empty** one means delete the key outright rather than storing `''`. Storing
 * the empty string would make `if (event.location)` and
 * `if (event.location !== undefined)` disagree — and for `externalUrl`, whose
 * mere presence is what refuses registrations, that disagreement decides
 * whether an event takes signups.
 */
function applyOptionalText(
  next: WorkshopEvent,
  patch: UpdateEventPatch,
  field: OptionalTextField,
): void {
  if (!Object.hasOwn(patch, field)) {
    return;
  }

  const value = patch[field]?.trim();

  if (value) {
    next[field] = value;
  } else {
    delete next[field];
  }
}

/** The event as it now stands, with both ids stamped on from the path. */
function eventFromSnapshot(
  snapshot: DocumentSnapshot<WorkshopEvent>,
): WorkshopEvent | null {
  const data = snapshot.data();

  return data
    ? {
        ...data,
        eventId: snapshot.id,
        orgId: snapshot.ref.parent.parent?.id ?? data.orgId,
      }
    : null;
}

/** ISO-8601 instant → Firestore `Timestamp`. */
function toTimestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}
