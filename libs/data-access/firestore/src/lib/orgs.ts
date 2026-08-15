import type { OrgRole, Organizer } from '@upskills/models';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { orgRef, orgsCol } from './collections';
import { asSlugTaken, reserveSlugInTransaction } from './slugs';
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

/** Raised when a membership write names an organizer that does not exist. */
class OrgNotFoundError extends Error {
  constructor(readonly orgId: string) {
    super(`Organizer "${orgId}" does not exist.`);
    this.name = 'OrgNotFoundError';
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
    reservedSlug = await reserveSlugInTransaction(
      transaction,
      'orgSlugs',
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

    return organizer;
  }).catch((error: unknown) => asSlugTaken('orgSlugs', reservedSlug)(error));
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
 * `true` only when `uid` can stop being an admin without stranding the org.
 *
 * Removing or demoting an admin is allowed exactly when some *other* member is
 * already an admin. The check runs against the document read inside the
 * transaction, so two simultaneous removals cannot both see "one other admin"
 * and both succeed — the second writer's transaction re-reads the result of the
 * first and finds no other admin left.
 */
function ensureNotLastAdmin(org: Organizer, uid: string): void {
  const hasAnotherAdmin = Object.entries(org.members).some(
    ([memberUid, membership]) =>
      memberUid !== uid && membership.role === 'admin',
  );

  if (!hasAnotherAdmin) {
    throw new LastOrgAdminError(org.orgId, uid);
  }
}
