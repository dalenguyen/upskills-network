import { OrgSlugSchema, SlugSchema } from '@upskills/validation';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import {
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
 *
 * ## Two namespaces, not one
 *
 * Organizer slugs are global, because `/{orgSlug}` is a top-level URL. Event
 * slugs are scoped to one organizer, because `/{orgSlug}/{eventSlug}` has
 * already resolved the organizer by the time the event slug is read — so two
 * organizers can each hold `react-basics` without either one losing.
 *
 * {@link SlugTarget} is how a caller says which namespace it means, and carrying
 * the `orgId` in the type is what makes "reserve an event slug" impossible to
 * write without naming the organizer it belongs to.
 */

/**
 * Which slug namespace an operation is addressing.
 *
 * A discriminated union rather than a collection name, because the two
 * namespaces do not take the same arguments: an event slug is meaningless
 * without the organizer that scopes it, and the compiler should say so.
 */
export type SlugTarget =
  { kind: 'org' } | { kind: 'event'; readonly orgId: string };

/** The organizer-slug namespace — global, one document per slug. */
export const ORG_SLUGS: SlugTarget = { kind: 'org' };

/** The event-slug namespace inside one organizer. */
export function eventSlugsOf(orgId: string): SlugTarget {
  return { kind: 'event', orgId };
}

/** The body of a reservation document, whichever collection it lives in. */
export type SlugReservation = OrgSlugReservation | EventSlugReservation;

/** How a target reads in an error message and a log line. */
function describe(target: SlugTarget): string {
  return target.kind === 'org'
    ? 'orgSlugs'
    : `organizers/${target.orgId}/eventSlugs`;
}

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
    readonly target: SlugTarget,
    readonly slug: string,
    /** Who holds it now — for logs and for the "that's already yours" case. */
    readonly heldBy: string,
  ) {
    super(`Slug "${slug}" in ${describe(target)} is already taken.`);
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
 *
 * For an organizer this also covers the reserved words: `/{orgSlug}` is a
 * top-level URL, so an org called `dashboard` would sit on top of a route. The
 * API schema rejects those too, but the rule belongs here as well — this is the
 * layer that actually creates the document, and it is reachable from a seed
 * script or an admin path that never passed through a request body.
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
  target: SlugTarget,
  slug: string,
  ownerId: string,
): Promise<string> {
  const normalized = normalizeSlug(target, slug);

  return runTransaction((transaction) =>
    reserveSlugInTransaction(transaction, target, normalized, ownerId),
  ).catch(asSlugTaken(target, normalized));
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
  target: SlugTarget,
  slug: string,
  ownerId: string,
): Promise<string> {
  const normalized = normalizeSlug(target, slug);
  const ref = reservationRef(target, normalized);

  // Read first — and reading a *missing* document is the whole mechanism:
  // it puts the empty key in the transaction's read set, so a racer that
  // creates it before we commit forces this transaction to be retried rather
  // than silently overwriting them.
  const holder = await readOwner(transaction, ref);

  if (holder !== null) {
    if (holder === ownerId) {
      return normalized;
    }

    throw new SlugTakenError(target, normalized, holder);
  }

  createReservation(transaction, target, normalized, ownerId);
  return normalized;
}

/**
 * Move an owner from one slug to another on a transaction the caller owns.
 *
 * This is the composable half of {@link renameSlug}: it performs the rename on
 * the transaction it is given, so a caller that is also updating the renamed
 * document can commit both the reservation change and the document change
 * together. The caller still owns the transaction's catch for the raw
 * `ALREADY_EXISTS` backstop; map it through {@link asSlugTaken}.
 *
 * As everywhere else, both reads happen before either write.
 *
 * @returns the normalized new slug.
 * @throws InvalidSlugError when either slug is not a legal slug.
 * @throws SlugTakenError when another owner holds `to`.
 */
export async function renameSlugInTransaction(
  transaction: Transaction,
  target: SlugTarget,
  ownerId: string,
  rename: SlugRename,
): Promise<string> {
  const from = normalizeSlug(target, rename.from);
  const to = normalizeSlug(target, rename.to);

  if (from === to) {
    return reserveSlugInTransaction(transaction, target, to, ownerId);
  }

  const refs = {
    from: reservationRef(target, from),
    to: reservationRef(target, to),
  };

  // Both reads before either write, per the house pattern — and both keys
  // join the read set, so a racer touching either one aborts this attempt.
  const currentHolder = await readOwner(transaction, refs.from);
  const targetHolder = await readOwner(transaction, refs.to);

  if (targetHolder !== null && targetHolder !== ownerId) {
    throw new SlugTakenError(target, to, targetHolder);
  }

  if (targetHolder === null) {
    createReservation(transaction, target, to, ownerId);
  }

  if (currentHolder === ownerId) {
    transaction.delete(refs.from);
  }

  return to;
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
  target: SlugTarget,
  ownerId: string,
  rename: SlugRename,
): Promise<string> {
  const to = normalizeSlug(target, rename.to);

  return runTransaction((transaction) =>
    renameSlugInTransaction(transaction, target, ownerId, rename),
  ).catch(asSlugTaken(target, to));
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
  target: SlugTarget,
  slug: string,
  ownerId: string,
): Promise<boolean> {
  const normalized = normalizeStoredSlug(slug);

  return runTransaction((transaction) =>
    releaseSlugInTransaction(transaction, target, normalized, ownerId),
  );
}

/**
 * Give a slug back on a transaction the caller already owns.
 *
 * The composable half of {@link releaseSlug}, for the delete paths: a document
 * and the slug it held have to disappear in the same commit, or a crash between
 * them either strands the slug forever or frees a name that still resolves to a
 * live page.
 *
 * @returns `true` when a reservation was actually deleted.
 */
export async function releaseSlugInTransaction(
  transaction: Transaction,
  target: SlugTarget,
  slug: string,
  ownerId: string,
): Promise<boolean> {
  // Shape only, never policy — see {@link normalizeStoredSlug}.
  const normalized = normalizeStoredSlug(slug);
  const ref = reservationRef(target, normalized);
  const holder = await readOwner(transaction, ref);

  if (holder !== ownerId) {
    return false;
  }

  transaction.delete(ref);
  return true;
}

/**
 * The reservation document for one slug.
 *
 * Always via the `collections.ts` helpers, so the converters — and therefore
 * the document shape `reads.ts` expects — stay in one place.
 */
function reservationRef(
  target: SlugTarget,
  slug: string,
): DocumentReference<SlugReservation> {
  return target.kind === 'org'
    ? orgSlugRef(slug)
    : eventSlugRef(target.orgId, slug);
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
  target: SlugTarget,
  slug: string,
  ownerId: string,
): void {
  if (target.kind === 'org') {
    transaction.create(orgSlugRef(slug), { orgId: ownerId });
  } else {
    transaction.create(eventSlugRef(target.orgId, slug), { eventId: ownerId });
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
  target: SlugTarget,
  slug: string,
): (error: unknown) => never {
  return (error: unknown) => {
    if ((error as { code?: number } | null)?.code === ALREADY_EXISTS) {
      throw new SlugTakenError(target, slug, 'unknown');
    }

    throw error;
  };
}

/**
 * The slug as it will be stored, or a typed error.
 *
 * The same schemas the API routes validate against, and they trim — so the value
 * returned here, not the caller's string, is what becomes the document id.
 *
 * The stricter `OrgSlugSchema` applies only to organizers: it additionally
 * rejects the reserved words, which matter because `/{orgSlug}` is a top-level
 * URL. An event slug is always the second segment of
 * `/{orgSlug}/{eventSlug}`, so there is no route for it to shadow and no reason
 * to refuse an organizer an event called `dashboard`.
 */
function normalizeSlug(target: SlugTarget, slug: string): string {
  return parseSlug(target.kind === 'org' ? OrgSlugSchema : SlugSchema, slug);
}

/**
 * Normalize a slug that is already **stored**, for giving it back.
 *
 * Deliberately the shape rule only, never {@link OrgSlugSchema}'s reserved-word
 * policy. Those two rules answer different questions: "may this name be taken?"
 * is a policy that can tighten over time, while "is this a legal document id?"
 * is a fact about the string.
 *
 * Applying the policy here would be a trap. Add a word to `RESERVED_SLUGS` that
 * some organizer already holds — a word that was free when they took it — and
 * `deleteOrg` starts throwing `InvalidSlugError` on the release, leaving an
 * organizer that can never be deleted because of a rule introduced after it was
 * created. A release only ever removes a reservation the owner already holds, so
 * there is nothing for the policy to protect.
 */
function normalizeStoredSlug(slug: string): string {
  return parseSlug(SlugSchema, slug);
}

/** Run one slug schema, reporting a failure as {@link InvalidSlugError}. */
function parseSlug(
  schema: typeof SlugSchema | typeof OrgSlugSchema,
  slug: string,
): string {
  const parsed = schema.safeParse(slug);

  if (!parsed.success) {
    throw new InvalidSlugError(
      slug,
      parsed.error.issues[0]?.message ?? 'invalid slug',
    );
  }

  return parsed.data;
}
