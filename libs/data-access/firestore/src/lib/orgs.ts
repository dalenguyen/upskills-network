import type { OrgRole, Organizer } from '@upskills/models';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { eventsCol, orgRef, orgsCol, userRef } from './collections';
import {
  ORG_SLUGS,
  asSlugTaken,
  releaseSlugInTransaction,
  reserveSlugInTransaction,
} from './slugs';
import { runTransaction } from './transactions';

/**
 * Organizer creation and membership writes.
 *
 * ## The invariant these transactions exist to hold
 *
 * `members` (the map) and `memberUids` (the array) are two representations of
 * one fact. The map is what the Firestore security rules can index
 * (`members[request.auth.uid]`), and the array is what an `array-contains`
 * query reads to answer "which orgs does this user belong to" for the org
 * switcher. Every membership write therefore updates **both** fields in the
 * same transaction — see the doc comment on `Organizer`.
 *
 * ## Shape
 *
 * Every function here follows the house transaction pattern: one
 * {@link runTransaction}, every read before any write, and the decision made
 * from what the transaction itself read. `createOrg` also composes the slug
 * reservation with the organizer document write in a single commit, so a taken
 * slug leaves no organizer document behind and a failed organizer write leaves
 * no dangling slug reservation.
 */

/**
 * Raised when a membership write would leave an org with no `admin`.
 *
 * A removal *or a demotion* counts: `setOrgMember(orgId, soleAdmin,
 * 'manager')` strands the org exactly as removing the sole admin would.
 */
export class LastOrgAdminError extends Error {
  constructor(
    readonly orgId: string,
    readonly uid: string,
  ) {
    super(
      `Removing or demoting "${uid}" would leave org "${orgId}" with no admin.`,
    );
    this.name = 'LastOrgAdminError';
  }
}

/**
 * Raised when a membership write names an organizer that does not exist.
 *
 * Exported because it is a normal typed outcome, not an internal detail: the
 * admin routes need to tell it apart from a genuine failure to answer anything
 * other than a 500.
 */
export class OrgNotFoundError extends Error {
  constructor(readonly orgId: string) {
    super(`Organizer "${orgId}" does not exist.`);
    this.name = 'OrgNotFoundError';
  }
}

/**
 * Raised when a user would get a second organizer.
 *
 * The product model is one org per user. Checked inside the `createOrg`
 * transaction against the user document, so two simultaneous creates for the
 * same user serialize on `users/{uid}` and exactly one commits — the loser
 * re-reads a populated `orgIds` and throws rather than silently building a
 * second org.
 */
export class OrgLimitExceededError extends Error {
  constructor(readonly uid: string) {
    super(`User "${uid}" already belongs to an organizer.`);
    this.name = 'OrgLimitExceededError';
  }
}

/**
 * Raised when deleting an organizer would strand the events it owns.
 *
 * Events live at `organizers/{orgId}/events/{eventId}`, and Firestore does not
 * delete a subcollection when its parent goes: the events would survive as
 * unreachable orphans while their slugs kept resolving to nothing. Rather than
 * cascade — a recursive delete that can partially fail, taking guest documents
 * and payment records with it — this path refuses, and the organizer deals with
 * their events first.
 *
 * A route maps this to **409**.
 */
export class OrgNotEmptyError extends Error {
  constructor(readonly orgId: string) {
    super(`Organizer "${orgId}" still owns events and cannot be deleted.`);
    this.name = 'OrgNotEmptyError';
  }
}

/** The caller-supplied half of a new organizer document. */
export interface CreateOrgDraft {
  name: string;
  /** Raw user input; normalized by the slug reservation, so callers never pre-process it. */
  slug: string;
  /** uid of the creator, from the authenticated session rather than the body. */
  createdBy: string;
}

/**
 * Create an organizer and its slug reservation in one transaction.
 *
 * The creator is the first member and the first `admin`. `createdAt` and the
 * creator's `addedAt` are generated once, outside the transaction, so a retry
 * cannot rewrite a different timestamp.
 *
 * @returns the created organizer, with its generated `orgId`.
 * @throws InvalidSlugError when `slug` is not a legal slug.
 * @throws SlugTakenError when another org already holds the slug.
 * @throws OrgLimitExceededError when `createdBy` already belongs to an org.
 */
export async function createOrg({
  name,
  slug,
  createdBy,
}: CreateOrgDraft): Promise<Organizer> {
  const doc = orgsCol().doc();
  const createdAt = Timestamp.now();
  // Read in the catch handler, at rejection time, rather than when the catch is
  // built: the transaction body assigns this to the normalized slug before the
  // commit can fail with ALREADY_EXISTS.
  let reservedSlug = slug;

  return runTransaction(async (transaction) => {
    // One org per user, serialized on the user document. This read happens
    // before any write, and reading the (usually present) document puts its key
    // in the transaction's read set — so two racing creates for the same user
    // contend on `users/{uid}`, and the loser re-reads a populated `orgIds` and
    // throws. Sign-in creates the user document before an org can exist, so it
    // is present by the time this runs.
    const userDoc = userRef(createdBy);
    const user = (await transaction.get(userDoc)).data();

    if (user && user.orgIds.length > 0) {
      throw new OrgLimitExceededError(createdBy);
    }

    reservedSlug = await reserveSlugInTransaction(
      transaction,
      ORG_SLUGS,
      slug,
      doc.id,
    );

    const organizer: Organizer = {
      orgId: doc.id,
      name: name.trim(),
      slug: reservedSlug,
      createdBy,
      members: {
        [createdBy]: { role: 'admin', addedAt: createdAt },
      },
      memberUids: [createdBy],
      createdAt,
    };

    // `create`, never `set`: the reservation read is what serializes
    // concurrent creates, and this is the backstop underneath it. A generated
    // org id cannot already exist, but if it somehow does the write fails
    // rather than overwriting a live organizer.
    transaction.create(doc, organizer);

    // Record the org on the creator in the same commit, so `me.get` can answer
    // "my org" and the next create for this user throws. Merge rather than
    // overwrite: the user document carries fields this path must not touch.
    if (user) {
      transaction.set(userDoc, { ...user, orgIds: [...user.orgIds, doc.id] });
    }

    return organizer;
  }).catch((error: unknown) => asSlugTaken(ORG_SLUGS, reservedSlug)(error));
}

/**
 * Delete an organizer that owns no events, releasing its slug.
 *
 * Three things have to move together, which is why they are one transaction:
 * the organizer document, the `orgSlugs/{slug}` reservation, and the `orgIds`
 * entry on every member's user document. Leave the reservation behind and the
 * name is unusable forever; leave `orgIds` behind and the member can never
 * create another org, because `createOrg` reads exactly that field to enforce
 * one-org-per-user.
 *
 * The emptiness check reads `organizers/{orgId}/events` with `limit(1)` inside
 * the transaction, so an event created concurrently joins the read set and
 * forces the retry that then refuses. Checking outside the transaction would
 * leave a window in which an event lands under an organizer being deleted.
 *
 * @throws OrgNotFoundError when `orgId` names no organizer.
 * @throws OrgNotEmptyError when the organizer still owns any event, of any
 *   status — cancelled events count, because their guest documents are still
 *   the payment record.
 */
export async function deleteOrg(orgId: string): Promise<void> {
  return runTransaction(async (transaction) => {
    const doc = orgRef(orgId);

    // Every read before any write: the organizer, the event probe, and each
    // member's user document.
    const existing = orgFromSnapshot(await transaction.get(doc));
    if (!existing) {
      throw new OrgNotFoundError(orgId);
    }

    const anyEvent = await transaction.get(eventsCol(orgId).limit(1));
    if (!anyEvent.empty) {
      throw new OrgNotEmptyError(orgId);
    }

    const memberDocs = await Promise.all(
      existing.memberUids.map(async (uid) => ({
        ref: userRef(uid),
        user: (await transaction.get(userRef(uid))).data(),
      })),
    );

    // Reads the reservation and then deletes it, so it straddles the boundary —
    // and has to run here, while nothing has been written yet.
    await releaseSlugInTransaction(
      transaction,
      ORG_SLUGS,
      existing.slug,
      orgId,
    );

    for (const { ref, user } of memberDocs) {
      if (!user) {
        continue;
      }

      // Merge rather than overwrite: the user document carries fields this path
      // must not touch.
      transaction.set(ref, {
        ...user,
        orgIds: user.orgIds.filter((id) => id !== orgId),
      });
    }

    transaction.delete(doc);
  });
}

/**
 * Add a member, or change an existing member's role.
 *
 * Writes the whole organizer document so `members` and `memberUids` can never
 * diverge. A role change preserves the original `addedAt`; a new member gets a
 * fresh one.
 *
 * @returns the updated organizer.
 * @throws LastOrgAdminError when demoting the last admin.
 */
export async function setOrgMember(
  orgId: string,
  uid: string,
  role: OrgRole,
): Promise<Organizer> {
  const addedAt = Timestamp.now();

  return runTransaction(async (transaction) => {
    const doc = orgRef(orgId);
    const org = orgFromSnapshot(await transaction.get(doc));
    if (!org) {
      throw new OrgNotFoundError(orgId);
    }

    const isExisting = Object.hasOwn(org.members, uid);
    const existing = isExisting ? org.members[uid] : undefined;

    if (existing?.role === role) {
      return org;
    }

    if (existing?.role === 'admin' && role !== 'admin') {
      ensureNotLastAdmin(org, uid);
    }

    const members: Organizer['members'] = {
      ...org.members,
      [uid]: { role, addedAt: existing?.addedAt ?? addedAt },
    };

    const next: Organizer = {
      ...org,
      members,
      memberUids: Object.keys(members),
    };

    transaction.set(doc, next);
    return next;
  });
}

/**
 * Remove a member.
 *
 * Removing a member who is not there is a no-op, not an error: callers cannot
 * always know whether a second tab already applied the same removal.
 *
 * @returns the updated organizer.
 * @throws LastOrgAdminError when removing the last admin.
 */
export async function removeOrgMember(
  orgId: string,
  uid: string,
): Promise<Organizer> {
  return runTransaction(async (transaction) => {
    const doc = orgRef(orgId);
    const org = orgFromSnapshot(await transaction.get(doc));
    if (!org) {
      throw new OrgNotFoundError(orgId);
    }

    if (!Object.hasOwn(org.members, uid)) {
      return org;
    }

    if (org.members[uid].role === 'admin') {
      ensureNotLastAdmin(org, uid);
    }

    const members = { ...org.members };
    delete members[uid];

    const next: Organizer = {
      ...org,
      members,
      memberUids: Object.keys(members),
    };

    transaction.set(doc, next);
    return next;
  });
}

/** The org as it now stands, with the id stamped on from the path. */
function orgFromSnapshot(
  snapshot: DocumentSnapshot<Organizer>,
): Organizer | null {
  const data = snapshot.data();
  return data ? { ...data, orgId: snapshot.id } : null;
}

/**
 * Throws unless `uid` can stop being an admin without stranding the org.
 *
 * Exported for `invites.ts`: accepting an invitation is a membership write like
 * any other, and it must not be the one path that can leave an org adminless.
 *
 * Removing or demoting an admin is allowed exactly when some *other* member is
 * already an admin. The check runs against the document read inside the
 * transaction, so two simultaneous removals cannot both see "one other admin"
 * and both succeed — the second writer's transaction re-reads the result of the
 * first and finds no other admin left.
 */
export function ensureNotLastAdmin(org: Organizer, uid: string): void {
  const hasAnotherAdmin = Object.entries(org.members).some(
    ([memberUid, membership]) =>
      memberUid !== uid && membership.role === 'admin',
  );

  if (!hasAnotherAdmin) {
    throw new LastOrgAdminError(org.orgId, uid);
  }
}
