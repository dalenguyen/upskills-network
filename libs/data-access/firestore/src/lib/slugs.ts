import { SlugSchema } from '@upskills/validation';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  eventSlugRef,
  orgSlugRef,
  type EventSlugReservation,
  type OrgSlugReservation,
} from './collections';
import { runTransaction } from './transactions';

/**
 * Slug uniqueness, enforced by the database.
 *
 * ## Why a reservation document
 *
 * "Query for the slug, then create it if nobody has it" is the same lost update
 * as counting guests before taking a seat: two organizers publishing
 * `/events/react-basics` at the same moment both find nothing and both write.
 * `orgSlugs/{slug}` and `eventSlugs/{slug}` move the decision into the key
 * space, where the database can enforce it — the slug *is* the document id, so
 * a second holder is not a race we have to win, it is a document that cannot
 * exist.
 *
 * Everything here follows the house transaction pattern from
 * `transactions.ts`: one {@link runTransaction}, every read before any write,
 * and the decision taken from what the transaction itself read.
 *
 * ## Why the same docs back the public pages
 *
 * `getEventBySlug` / `getOrgBySlug` in `reads.ts` resolve a slug with a single
 * `get()` on exactly these documents, so the shape written here — `{ eventId }`
 * and `{ orgId }` — is load-bearing. It is not a duplicate of the `slug` field
 * on the event or organizer; it is the index that makes that field unique and
 * O(1) to look up.
 */

/** The two collections that key documents by slug. */
export type SlugCollection =
  typeof COLLECTIONS.orgSlugs | typeof COLLECTIONS.eventSlugs;

/** The body of a reservation document, whichever collection it lives in. */
export type SlugReservation = OrgSlugReservation | EventSlugReservation;

/**
 * Raised when the slug is already held by somebody else.
 *
 * A route maps this to **409 Conflict** with the offending slug — it is a
 * normal answer to "can I have this name?", not a fault. Never let the
 * underlying gRPC `ALREADY_EXISTS` reach a caller: it carries a document path
 * and reads like a 500.
 */
export class SlugTakenError extends Error {
  constructor(
    readonly collection: SlugCollection,
    readonly slug: string,
    /** Who holds it now — for logs and for the "that's already yours" case. */
    readonly heldBy: string,
  ) {
    super(`Slug "${slug}" in ${collection} is already taken.`);
    this.name = 'SlugTakenError';
  }
}

/**
 * Raised when the slug could never be a legal reservation document id.
 *
 * A route maps this to **400**. Checked here rather than trusted from the
 * caller because an unchecked `/` would silently address a *subcollection*
 * instead of failing, and a slug that differs only by case or padding would
 * reserve a second document for what users read as the same name.
 */
export class InvalidSlugError extends Error {
  constructor(
    readonly slug: string,
    readonly reason: string,
  ) {
    super(`Slug "${slug}" is not usable: ${reason}`);
    this.name = 'InvalidSlugError';
  }
}

/** Where the two slugs of a rename are going. */
export interface SlugRename {
  /** The slug being given up. Ignored if the owner does not actually hold it. */
  from: string;
  /** The slug being taken. */
  to: string;
}

/**
 * Take `slug` for `ownerId`, or fail because somebody else has it.
 *
 * Re-reserving a slug you already hold is a deliberate no-op rather than a
 * conflict: a retried create, a double-submitted form, or a rename back to the
 * current name must not 409 against itself.
 *
 * @returns the normalized slug — store *this* on the event/organizer document,
 *   so the `slug` field and the reservation id can never disagree.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 * @throws SlugTakenError when another owner holds it.
 */
export async function reserveSlug(
  collection: SlugCollection,
  slug: string,
  ownerId: string,
): Promise<string> {
  const normalized = normalizeSlug(slug);

  return runTransaction((transaction) =>
    reserveSlugInTransaction(transaction, collection, normalized, ownerId),
  ).catch(asSlugTaken(collection, normalized));
}

/**
 * Reserve a slug on a transaction the caller already owns.
 *
 * This is the composable half of {@link reserveSlug}: it performs the
 * reservation read and write on the transaction it is given, so a caller that
 * is already writing another document — an organizer being created, say — can
 * commit the slug reservation and that document together. The caller still owns
 * the transaction's catch for the raw `ALREADY_EXISTS` backstop; map it through
 * {@link asSlugTaken}.
 *
 * As everywhere else, the read happens before the write — Firestore rejects a
 * transaction that does otherwise.
 *
 * @returns the normalized slug.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 * @throws SlugTakenError when another owner holds it.
 */
export async function reserveSlugInTransaction(
  transaction: Transaction,
  collection: SlugCollection,
  slug: string,
  ownerId: string,
): Promise<string> {
  const normalized = normalizeSlug(slug);
  const ref = reservationRef(collection, normalized);

  // Read first — and reading a *missing* document is the whole mechanism:
  // it puts the empty key in the transaction's read set, so a racer that
  // creates it before we commit forces this transaction to be retried rather
  // than silently overwriting them.
  const holder = await readOwner(transaction, ref);

  if (holder !== null) {
    if (holder === ownerId) {
      return normalized;
    }

    throw new SlugTakenError(collection, normalized, holder);
  }

  createReservation(transaction, collection, normalized, ownerId);
  return normalized;
}

/**
 * Move an owner from one slug to another **in one commit**.
 *
 * Both halves land together or neither does. Releasing the old slug in one
 * transaction and taking the new one in another leaves two ways to break: a
 * crash between them strands the old slug forever, and the gap is a window in
 * which the new slug can be sniped while the event still advertises the old
 * one.
 *
 * Renaming to the slug you already hold releases the old one and is otherwise a
 * no-op. A `from` slug held by somebody else is left strictly alone — a rename
 * releases only what this owner actually holds.
 *
 * @returns the normalized new slug.
 * @throws InvalidSlugError when either slug is not a legal slug.
 * @throws SlugTakenError when another owner holds `to`.
 */
export async function renameSlug(
  collection: SlugCollection,
  ownerId: string,
  rename: SlugRename,
): Promise<string> {
  const from = normalizeSlug(rename.from);
  const to = normalizeSlug(rename.to);

  if (from === to) {
    return reserveSlug(collection, to, ownerId);
  }

  return runTransaction(async (transaction) => {
    const refs = {
      from: reservationRef(collection, from),
      to: reservationRef(collection, to),
    };

    // Both reads before either write, per the house pattern — and both keys
    // join the read set, so a racer touching either one aborts this attempt.
    const currentHolder = await readOwner(transaction, refs.from);
    const targetHolder = await readOwner(transaction, refs.to);

    if (targetHolder !== null && targetHolder !== ownerId) {
      throw new SlugTakenError(collection, to, targetHolder);
    }

    if (targetHolder === null) {
      createReservation(transaction, collection, to, ownerId);
    }

    if (currentHolder === ownerId) {
      transaction.delete(refs.from);
    }

    return to;
  }).catch(asSlugTaken(collection, to));
}

/**
 * Give a slug back, when the event or organizer holding it is deleted.
 *
 * Only ever deletes a reservation this owner holds; a slug held by somebody
 * else — or already gone — is left untouched.
 *
 * @returns `true` when a reservation was actually deleted.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 */
export async function releaseSlug(
  collection: SlugCollection,
  slug: string,
  ownerId: string,
): Promise<boolean> {
  const normalized = normalizeSlug(slug);

  return runTransaction(async (transaction) => {
    const ref = reservationRef(collection, normalized);
    const holder = await readOwner(transaction, ref);

    if (holder !== ownerId) {
      return false;
    }

    transaction.delete(ref);
    return true;
  });
}

/**
 * The reservation document for one slug.
 *
 * Always via the `collections.ts` helpers, so the converters — and therefore
 * the document shape `reads.ts` expects — stay in one place.
 */
function reservationRef(
  collection: SlugCollection,
  slug: string,
): DocumentReference<SlugReservation> {
  return collection === COLLECTIONS.orgSlugs
    ? orgSlugRef(slug)
    : eventSlugRef(slug);
}

/** Who holds this reservation right now, or `null` if nobody does. */
async function readOwner(
  transaction: Transaction,
  ref: DocumentReference<SlugReservation>,
): Promise<string | null> {
  const data = (await transaction.get(ref)).data();
  if (!data) {
    return null;
  }

  return 'orgId' in data ? data.orgId : data.eventId;
}

/**
 * Write the reservation with `create`, never `set`.
 *
 * The transaction's read set is what actually serializes concurrent reservers;
 * `create` is the backstop underneath it. If a reservation somehow appears
 * between the read and the commit, this fails the write rather than
 * overwriting a live slug and pointing a public URL at the wrong event.
 *
 * The branch is what keeps the two document shapes honest: `orgSlugs` gets
 * `{ orgId }` and `eventSlugs` gets `{ eventId }`, checked by the compiler,
 * because `getOrgBySlug` / `getEventBySlug` read those field names.
 */
function createReservation(
  transaction: Transaction,
  collection: SlugCollection,
  slug: string,
  ownerId: string,
): void {
  if (collection === COLLECTIONS.orgSlugs) {
    transaction.create(orgSlugRef(slug), { orgId: ownerId });
  } else {
    transaction.create(eventSlugRef(slug), { eventId: ownerId });
  }
}

/** gRPC `ALREADY_EXISTS` — what `transaction.create` fails with. */
const ALREADY_EXISTS = 6;

/**
 * Turn the backstop's raw gRPC failure into the same typed error as the normal
 * path, so a route has exactly one thing to map to 409.
 *
 * Exported for create-once callers that compose {@link reserveSlugInTransaction}
 * with another write: their transaction can hit the same `ALREADY_EXISTS`
 * backstop, and they need the same translation applied to their promise.
 */
export function asSlugTaken(
  collection: SlugCollection,
  slug: string,
): (error: unknown) => never {
  return (error: unknown) => {
    if ((error as { code?: number } | null)?.code === ALREADY_EXISTS) {
      throw new SlugTakenError(collection, slug, 'unknown');
    }

    throw error;
  };
}

/**
 * The slug as it will be stored, or a typed error.
 *
 * `SlugSchema` is the same rule the API routes validate against, and it trims —
 * so the value it returns, not the caller's string, is what becomes the
 * document id.
 */
function normalizeSlug(slug: string): string {
  const parsed = SlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new InvalidSlugError(
      slug,
      parsed.error.issues[0]?.message ?? 'invalid slug',
    );
  }

  return parsed.data;
}
