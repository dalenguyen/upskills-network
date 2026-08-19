import type {
  OrgInvite,
  OrgInviteStatus,
  OrgRole,
  Organizer,
} from '@upskills/models';
import { normalizeEmail } from '@upskills/validation';
import { randomBytes } from 'node:crypto';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { orgInviteRef, orgInvitesCol, orgRef } from './collections';
import { OrgNotFoundError, ensureNotLastAdmin } from './orgs';
import { runTransaction } from './transactions';

/**
 * Staff invitations: create, accept, revoke.
 *
 * ## Why acceptance is one transaction
 *
 * Accepting does two things that must not come apart: it writes the membership
 * onto the organizer (`members` *and* `memberUids`, the invariant `orgs.ts`
 * exists to hold) and it stamps the invite accepted. Split across two commits,
 * a crash in between leaves either a member who still holds a live invitation
 * token or a spent token that granted nothing. Both documents are therefore
 * read and written inside one {@link runTransaction}, and the invite's own read
 * is what serializes two clicks of the same link: the second attempt re-reads
 * an `acceptedAt` and stops.
 *
 * ## Why an invite is not a membership
 *
 * Nothing is written to the organizer when an invite is created. A pending
 * invite grants no access — the security rules read `members[uid]`, and until
 * acceptance there is no entry there. That is what lets an invitation name an
 * email address with no account behind it: there is no uid to key a membership
 * by until the invitee signs in.
 */

/** How long an invitation stays acceptable. */
export const INVITE_TTL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Raised when a token or invite id names no invitation. */
export class InviteNotFoundError extends Error {
  constructor(readonly inviteId: string) {
    super(`Invitation "${inviteId}" does not exist.`);
    this.name = 'InviteNotFoundError';
  }
}

/**
 * Raised when an invitation exists but cannot be accepted.
 *
 * `status` says why, so a route can tell "you already joined" from "this link
 * ran out" without re-deriving it from the timestamps.
 */
export class InviteNotPendingError extends Error {
  constructor(
    readonly inviteId: string,
    readonly status: OrgInviteStatus,
  ) {
    super(`Invitation "${inviteId}" is ${status}.`);
    this.name = 'InviteNotPendingError';
  }
}

/**
 * Raised when the signed-in caller is not who the invitation was sent to.
 *
 * An invitation is addressed to one mailbox. A forwarded link must not let
 * whoever received it join in the invitee's place, so acceptance compares the
 * accepting account's email against the invited address.
 */
export class InviteEmailMismatchError extends Error {
  constructor(
    readonly inviteId: string,
    readonly invitedEmail: string,
  ) {
    super(`Invitation "${inviteId}" was not sent to this account.`);
    this.name = 'InviteEmailMismatchError';
  }
}

/** What an invite is doing right now, given the clock. */
export function orgInviteStatus(
  invite: OrgInvite,
  now: Date = new Date(),
): OrgInviteStatus {
  if (invite.acceptedAt !== undefined) {
    return 'accepted';
  }

  if (invite.revokedAt !== undefined) {
    return 'revoked';
  }

  return invite.expiresAt.toDate().getTime() <= now.getTime()
    ? 'expired'
    : 'pending';
}

/** An unguessable acceptance token. See {@link OrgInvite.token}. */
function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateOrgInviteDraft {
  orgId: string;
  /** Raw input; normalized here, so callers never pre-process it. */
  email: string;
  role: OrgRole;
  /** uid of the admin sending it, from the session rather than the body. */
  invitedBy: string;
}

/**
 * Invite one email address to an organizer.
 *
 * Re-inviting an address that already has an outstanding invitation **replaces**
 * it: the previous invite is revoked in the same commit and a fresh token is
 * issued. That is what the roster's "Resend" does, and it means an old link in
 * an old mailbox stops working the moment a new one is sent — one address never
 * has two live tokens.
 *
 * @returns the stored invitation, token included. The token is for the email
 *   this call is about to send; it must not be returned to a browser.
 * @throws OrgNotFoundError when `orgId` names no organizer.
 */
export async function createOrgInvite(
  draft: CreateOrgInviteDraft,
): Promise<OrgInvite> {
  const email = normalizeEmail(draft.email);
  const doc = orgInvitesCol().doc();
  const createdAt = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    createdAt.toMillis() + INVITE_TTL_DAYS * MS_PER_DAY,
  );

  return runTransaction(async (transaction) => {
    const org = orgFrom(await transaction.get(orgRef(draft.orgId)));

    if (!org) {
      throw new OrgNotFoundError(draft.orgId);
    }

    // Every read before any write, as everywhere else in this lib. The query
    // joins the transaction's read set, so a second invite for the same address
    // committing underneath this one forces a retry rather than leaving two
    // live tokens.
    const outstanding = await transaction.get(
      orgInvitesCol()
        .where('orgId', '==', draft.orgId)
        .where('email', '==', email),
    );

    for (const snapshot of outstanding.docs) {
      const existing = { ...snapshot.data(), inviteId: snapshot.id };

      if (orgInviteStatus(existing, createdAt.toDate()) === 'pending') {
        transaction.update(snapshot.ref, { revokedAt: createdAt });
      }
    }

    const invite: OrgInvite = {
      inviteId: doc.id,
      orgId: draft.orgId,
      email,
      role: draft.role,
      token: newInviteToken(),
      invitedBy: draft.invitedBy,
      createdAt,
      expiresAt,
    };

    transaction.create(doc, invite);

    return invite;
  });
}

/** `orgInvites/{inviteId}` */
export async function getOrgInvite(
  inviteId: string,
): Promise<OrgInvite | null> {
  const snapshot = await orgInviteRef(inviteId).get();
  const data = snapshot.data();

  return data ? { ...data, inviteId: snapshot.id } : null;
}

/**
 * The invitation a token accepts, or `null`.
 *
 * An equality query rather than a key lookup, because the token is deliberately
 * not the document id — see {@link OrgInvite}. Backed by the automatic
 * single-field index on `token`.
 */
export async function findOrgInviteByToken(
  token: string,
): Promise<OrgInvite | null> {
  const snapshot = await orgInvitesCol()
    .where('token', '==', token)
    .limit(1)
    .get();

  const doc = snapshot.docs[0];

  return doc ? { ...doc.data(), inviteId: doc.id } : null;
}

/**
 * Every invitation for one org that has not been accepted or revoked, oldest
 * first — the pending and expired rows the roster shows beside its members.
 *
 * Accepted invites are left out on purpose: once accepted, the membership is
 * the record, and showing both would double the person on the roster.
 */
export async function listOrgInvites(orgId: string): Promise<OrgInvite[]> {
  const snapshot = await orgInvitesCol()
    .where('orgId', '==', orgId)
    .orderBy('createdAt', 'asc')
    .get();

  return snapshot.docs
    .map((doc): OrgInvite => ({ ...doc.data(), inviteId: doc.id }))
    .filter(
      (invite) =>
        invite.acceptedAt === undefined && invite.revokedAt === undefined,
    );
}

/**
 * Withdraw an invitation. Revoking an already-revoked invite is a no-op, not an
 * error: two admins clicking the same button is not a conflict worth surfacing.
 *
 * @throws InviteNotFoundError when the id names no invitation.
 * @throws InviteNotPendingError when it was already accepted — that is a
 *   membership now, and removing it is `removeOrgMember`'s job.
 */
export async function revokeOrgInvite(inviteId: string): Promise<OrgInvite> {
  const revokedAt = Timestamp.now();

  return runTransaction(async (transaction) => {
    const doc = orgInviteRef(inviteId);
    const snapshot = await transaction.get(doc);
    const data = snapshot.data();

    if (!data) {
      throw new InviteNotFoundError(inviteId);
    }

    const invite: OrgInvite = { ...data, inviteId: snapshot.id };

    if (invite.acceptedAt !== undefined) {
      throw new InviteNotPendingError(inviteId, 'accepted');
    }

    if (invite.revokedAt !== undefined) {
      return invite;
    }

    transaction.update(doc, { revokedAt });

    return { ...invite, revokedAt };
  });
}

export interface AcceptOrgInviteResult {
  org: Organizer;
  invite: OrgInvite;
}

export interface AcceptOrgInviteOptions {
  /** The uid the membership is written for — the invitee's own account. */
  uid: string;
  /**
   * The accepting account's email. When given, it must match the invited
   * address: a forwarded link cannot let someone else take the seat. Omitted
   * only by the admin-confirmation path, where an org admin has already
   * decided who this person is.
   */
  email?: string;
  /** uid of the org admin confirming on the invitee's behalf, if any. */
  acceptedByAdmin?: string;
}

/**
 * Turn an invitation into a membership.
 *
 * Idempotent for the invitee who already accepted: a second click re-reads
 * `acceptedAt` and throws {@link InviteNotPendingError} rather than writing the
 * membership twice.
 *
 * An existing member takes the invited role, the same "last write wins on role"
 * rule `setOrgMember` follows — and under the same guard: an invitation cannot
 * demote the last admin, so accepting a `volunteer` invite as an org's only
 * admin is refused rather than quietly stranding the org. Nothing else about
 * membership is special here; that is the point.
 *
 * @throws InviteNotFoundError, InviteNotPendingError, InviteEmailMismatchError,
 *   OrgNotFoundError, LastOrgAdminError.
 */
export async function acceptOrgInvite(
  inviteId: string,
  options: AcceptOrgInviteOptions,
): Promise<AcceptOrgInviteResult> {
  const acceptedAt = Timestamp.now();

  return runTransaction(async (transaction) => {
    const inviteDoc = orgInviteRef(inviteId);
    const inviteSnapshot = await transaction.get(inviteDoc);
    const inviteData = inviteSnapshot.data();

    if (!inviteData) {
      throw new InviteNotFoundError(inviteId);
    }

    const invite: OrgInvite = { ...inviteData, inviteId: inviteSnapshot.id };
    const status = orgInviteStatus(invite, acceptedAt.toDate());

    if (status !== 'pending') {
      throw new InviteNotPendingError(inviteId, status);
    }

    if (
      options.email !== undefined &&
      normalizeEmail(options.email) !== invite.email
    ) {
      throw new InviteEmailMismatchError(inviteId, invite.email);
    }

    const orgDoc = orgRef(invite.orgId);
    const org = orgFrom(await transaction.get(orgDoc));

    if (!org) {
      throw new OrgNotFoundError(invite.orgId);
    }

    const existing = org.members[options.uid];

    if (existing?.role === 'admin' && invite.role !== 'admin') {
      ensureNotLastAdmin(org, options.uid);
    }

    const members: Organizer['members'] = {
      ...org.members,
      [options.uid]: {
        role: invite.role,
        // A returning member keeps the day they first joined.
        addedAt: existing?.addedAt ?? acceptedAt,
      },
    };

    const next: Organizer = {
      ...org,
      members,
      memberUids: Object.keys(members),
    };

    const accepted: OrgInvite = {
      ...invite,
      acceptedAt,
      acceptedBy: options.uid,
      ...(options.acceptedByAdmin === undefined
        ? {}
        : { acceptedByAdmin: options.acceptedByAdmin }),
    };

    transaction.set(orgDoc, next);
    transaction.update(inviteDoc, {
      acceptedAt,
      acceptedBy: options.uid,
      ...(options.acceptedByAdmin === undefined
        ? {}
        : { acceptedByAdmin: options.acceptedByAdmin }),
    });

    return { org: next, invite: accepted };
  });
}

/** The org as it now stands, with the id stamped on from the path. */
function orgFrom(snapshot: DocumentSnapshot<Organizer>): Organizer | null {
  const data = snapshot.data();
  return data ? { ...data, orgId: snapshot.id } : null;
}
