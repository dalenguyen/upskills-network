import type { AuthContext } from '@upskills/auth';
import type {
  OrgInvite,
  OrgInviteStatus,
  OrgRole,
  Organizer,
  User,
} from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, conflict, notFound, toHttpError } from '../http-error';

/**
 * The invitee's side of an invitation: look at it, then accept it.
 *
 * ## Why looking is unauthenticated and accepting is not
 *
 * The link arrives in an email, and the person clicking it usually has no
 * session yet — often no account at all. Requiring a sign-in *before* showing
 * anything would mean asking someone to register for a page they cannot see the
 * purpose of, so the detail route answers the org name and the role from the
 * token alone. It deliberately answers nothing else: no roster, no member
 * count, no invitee list, and the email is echoed only so the accept page can
 * say which address to sign in with — which the holder of the mailbox already
 * knows.
 *
 * Accepting requires a session, because a membership must be keyed by a uid,
 * and it requires that the session's email match the invited address. The token
 * proves *which* invitation; the session proves *who* is taking it. Without the
 * second half, a forwarded email would hand the seat to whoever opened it.
 */

export interface InviteDetailResponse {
  /** Only ever a pending invitation's details; see the status codes below. */
  invite: {
    orgName: string;
    role: OrgRole;
    /** The address that must be signed in to accept. */
    email: string;
    /** ISO-8601. */
    expiresAt: string;
  };
}

export interface InviteDetailDeps {
  /** `findOrgInviteByToken` from `@upskills/firestore`. */
  findOrgInviteByToken(token: string): Promise<OrgInvite | null>;
  /** `orgInviteStatus` from `@upskills/firestore`. */
  orgInviteStatus(invite: OrgInvite, now?: Date): OrgInviteStatus;
  /** `getOrg` from `@upskills/firestore`. */
  getOrg(orgId: string): Promise<Organizer | null>;
}

/**
 * `GET /api/v1/invites/:token` — what this invitation is offering.
 *
 * A token that names nothing, and a token whose invitation is spent, answer the
 * same 404 and 409 they would to anybody: there is nothing here worth hiding
 * from the holder of the link, and nothing here a stranger without the link can
 * reach.
 */
export function createInviteDetailHandler(
  deps: InviteDetailDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const invite = await requireInvite(deps, readToken(event));
      const status = deps.orgInviteStatus(invite);

      if (status !== 'pending') {
        throw conflict('invite-not-pending', inviteStatusMessage(status));
      }

      const org = await deps.getOrg(invite.orgId);

      if (org === null) {
        throw notFound('invite-not-found', 'No such invitation.');
      }

      return {
        invite: {
          orgName: org.name,
          role: invite.role,
          email: invite.email,
          expiresAt: invite.expiresAt.toDate().toISOString(),
        },
      } satisfies InviteDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export interface InviteAcceptResponse {
  /** Where the browser should go next, now that the caller is staff. */
  orgId: string;
  orgName: string;
  role: OrgRole;
}

export interface InviteAcceptDeps {
  /** `requireAuth` from `@upskills/auth`. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `findOrgInviteByToken` from `@upskills/firestore`. */
  findOrgInviteByToken(token: string): Promise<OrgInvite | null>;
  /** `orgInviteStatus` from `@upskills/firestore`. */
  orgInviteStatus(invite: OrgInvite, now?: Date): OrgInviteStatus;
  /** `getUser` from `@upskills/firestore`. */
  getUser(uid: string): Promise<User | null>;
  /** `acceptOrgInvite` from `@upskills/firestore`. */
  acceptOrgInvite(
    inviteId: string,
    options: { uid: string; email?: string; acceptedByAdmin?: string },
  ): Promise<{ org: Organizer; invite: OrgInvite }>;
}

/**
 * `POST /api/v1/invites/:token/accept` — take the seat.
 *
 * The email comparison happens inside `acceptOrgInvite`'s transaction, against
 * the invitation it read there, so two clicks cannot both pass the check and
 * both write. The uid comes from the session and the address from the *user
 * document* rather than the session claims: the document is the one this app
 * normalizes and owns, and it is what every other email comparison in the
 * codebase is made against.
 */
export function createInviteAcceptHandler(
  deps: InviteAcceptDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const token = readToken(event);
      const { uid } = await deps.requireAuth(event);

      const invite = await requireInvite(deps, token);
      const status = deps.orgInviteStatus(invite);

      if (status !== 'pending') {
        throw conflict('invite-not-pending', inviteStatusMessage(status));
      }

      const user = await deps.getUser(uid);

      if (user === null) {
        // A verified session always has a user document — sign-in writes it
        // before it mints the cookie. Reaching here means the document was
        // deleted underneath a live session, which is not the invitee's fault
        // to explain away as a mismatch.
        throw notFound('user-not-found', 'This account no longer exists.');
      }

      const { org, invite: accepted } = await deps.acceptOrgInvite(
        invite.inviteId,
        { uid, email: user.email },
      );

      return {
        orgId: org.orgId,
        orgName: org.name,
        role: accepted.role,
      } satisfies InviteAcceptResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/** The token from the path, or a 400. */
function readToken(event: H3Event): string {
  const token = getRouterParam(event, 'token');

  if (token === undefined || token === '') {
    throw badRequest(
      'invalid-token',
      'Expected a non-empty token route parameter.',
    );
  }

  return token;
}

async function requireInvite(
  deps: { findOrgInviteByToken(token: string): Promise<OrgInvite | null> },
  token: string,
): Promise<OrgInvite> {
  const invite = await deps.findOrgInviteByToken(token);

  if (invite === null) {
    throw notFound('invite-not-found', 'No such invitation.');
  }

  return invite;
}

/** Why a non-pending invitation cannot be used, in the invitee's terms. */
function inviteStatusMessage(status: OrgInviteStatus): string {
  if (status === 'accepted') {
    return 'This invitation has already been accepted.';
  }

  if (status === 'revoked') {
    return 'This invitation was withdrawn.';
  }

  return 'This invitation has expired. Ask an organizer to send a new one.';
}
