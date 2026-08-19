import type {
  OrgInvite,
  OrgInviteStatus,
  OrgRole,
  Organizer,
  User,
} from '@upskills/models';
import {
  CreateOrgInviteSchema,
  OrgInviteRefSchema,
} from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, conflict, notFound, toHttpError } from '../http-error';
import { emailsAfterWrite, listAfterWrite } from '../member-emails';
import { toOrgInviteView, type OrgInviteView } from './invite-view';

/**
 * An org admin managing invitations: invite, resend, revoke, confirm.
 *
 * ## Why these are factories over an `authorizeOrg` dep
 *
 * The platform-admin console and the organizer's own dashboard run the same
 * four operations against the same documents and differ in exactly one thing:
 * who is allowed to ask. Duplicating the handlers per surface — the shape the
 * member routes grew into — means every fix to the invitation rules has to be
 * made twice and stays correct only by discipline. Here the surfaces inject
 * their authorization and their org projection, and share the behavior, so the
 * two cannot drift on what an expired invite or a stranger's invite id means.
 *
 * ## The response
 *
 * Every one of these answers `{ org, invites }`: the roster and its outstanding
 * invitations, after the write. The page renders both as one list, so answering
 * only half would make it fetch the other half immediately.
 */

export interface OrgInvitesResponse<TOrg> {
  org: TOrg;
  /** Outstanding invitations — pending and expired, never accepted ones. */
  invites: OrgInviteView[];
}

/** What a surface must supply for every invite operation. */
export interface OrgInvitesBaseDeps<TOrg> {
  /**
   * Authorize the caller against this org and hand back the org document.
   *
   * Platform admins pass `requireAdmin` plus a read; an org's own admins pass
   * `requireOrgRole(event, orgId, 'admin')`, which already carries the org.
   * Either way a caller who may not manage this org never reaches the body.
   */
  authorizeOrg(
    event: H3Event,
    orgId: string,
  ): Promise<{ uid: string; org: Organizer }>;
  /** `toAdminOrg` or `toDashboardOrg`. */
  serializeOrg(org: Organizer, emails: Record<string, string>): TOrg;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
  /** `listOrgInvites` from `@upskills/firestore`. */
  listOrgInvites(orgId: string): Promise<OrgInvite[]>;
  /** `orgInviteStatus` from `@upskills/firestore`. */
  orgInviteStatus(invite: OrgInvite, now?: Date): OrgInviteStatus;
}

export interface OrgInvitesCreateDeps<TOrg> extends OrgInvitesBaseDeps<TOrg> {
  /** `createOrgInvite` from `@upskills/firestore`. */
  createOrgInvite(draft: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedBy: string;
  }): Promise<OrgInvite>;
  /** `getUser` from `@upskills/firestore` — the inviter, for the email copy. */
  getUser(uid: string): Promise<User | null>;
  /** `sendOrgInviteEmail` from `@upskills/email`. */
  sendOrgInviteEmail(details: {
    email: string;
    orgName: string;
    role: OrgRole;
    token: string;
    expiresAt: Date;
    invitedByName?: string;
  }): Promise<{ sent: boolean }>;
}

export interface OrgInvitesRevokeDeps<TOrg> extends OrgInvitesBaseDeps<TOrg> {
  /** `getOrgInvite` from `@upskills/firestore`. */
  getOrgInvite(inviteId: string): Promise<OrgInvite | null>;
  /** `revokeOrgInvite` from `@upskills/firestore`. */
  revokeOrgInvite(inviteId: string): Promise<OrgInvite>;
}

export interface OrgInvitesConfirmDeps<TOrg> extends OrgInvitesBaseDeps<TOrg> {
  /** `getOrgInvite` from `@upskills/firestore`. */
  getOrgInvite(inviteId: string): Promise<OrgInvite | null>;
  /** `findUserByEmail` from `@upskills/firestore`. */
  findUserByEmail(email: string): Promise<User | null>;
  /** `acceptOrgInvite` from `@upskills/firestore`. */
  acceptOrgInvite(
    inviteId: string,
    options: { uid: string; email?: string; acceptedByAdmin?: string },
  ): Promise<{ org: Organizer; invite: OrgInvite }>;
}

/**
 * `POST /…/orgs/:orgId/invites` — invite an email address, or resend.
 *
 * Resending is the same call: `createOrgInvite` revokes any live invitation for
 * that address and issues a fresh token, so one mailbox never holds two working
 * links. The invitee gets nothing but an offer — no membership is written here,
 * which is what lets this name an address that has never signed in.
 *
 * A failed send is **not** a failed invite: the invitation is committed before
 * the email leaves, and `sendOrgInviteEmail` reports rather than throws, so a
 * mail outage leaves a pending row the admin can resend instead of a 500 and no
 * record of who was invited.
 */
export function createOrgInvitesCreateHandler<TOrg>(
  deps: OrgInvitesCreateDeps<TOrg>,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = requireOrgId(event);
      const { uid, org } = await deps.authorizeOrg(event, orgId);

      const parsed = CreateOrgInviteSchema.safeParse(
        await readBody<unknown>(event),
      );

      if (!parsed.success) {
        throw badRequest(
          'invalid-invite',
          'Expected a JSON body of the form { "email": "…", "role": "…" }.',
        );
      }

      await rejectIfAlreadyMember(deps, org, parsed.data.email);

      const invite = await deps.createOrgInvite({
        orgId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: uid,
      });

      const inviter = await deps.getUser(uid);

      await deps.sendOrgInviteEmail({
        email: invite.email,
        orgName: org.name,
        role: invite.role,
        token: invite.token,
        expiresAt: invite.expiresAt.toDate(),
        invitedByName: inviter?.name,
      });

      return await answer(deps, org);
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * `DELETE /…/orgs/:orgId/invites` — withdraw an outstanding invitation.
 *
 * The invite id is checked against the org in the path before anything is
 * written: an id is a handle every admin of *some* org can hold, and without
 * this check one org's admin could revoke another org's invitation by pasting
 * an id. A revoked token stops working immediately.
 */
export function createOrgInvitesRevokeHandler<TOrg>(
  deps: OrgInvitesRevokeDeps<TOrg>,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = requireOrgId(event);
      const { org } = await deps.authorizeOrg(event, orgId);
      const inviteId = readInviteId(await readBody<unknown>(event));

      await requireInviteOfOrg(deps, inviteId, orgId);
      await deps.revokeOrgInvite(inviteId);

      return await answer(deps, org);
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * `POST /…/orgs/:orgId/invites/confirm` — accept on the invitee's behalf.
 *
 * The escape hatch for "I know this person, they are standing right here": an
 * org admin can turn a pending invitation into a membership without waiting for
 * the email click. It still needs an account to key the membership by, so an
 * address that has never signed in answers 409 rather than inventing a uid —
 * the invitation stays pending, and the link still works when they do sign in.
 *
 * `acceptedByAdmin` records who confirmed it, so the roster's history does not
 * claim the invitee clicked a link they never saw.
 */
export function createOrgInvitesConfirmHandler<TOrg>(
  deps: OrgInvitesConfirmDeps<TOrg>,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = requireOrgId(event);
      const { uid } = await deps.authorizeOrg(event, orgId);
      const inviteId = readInviteId(await readBody<unknown>(event));

      const invite = await requireInviteOfOrg(deps, inviteId, orgId);
      const status = deps.orgInviteStatus(invite);

      if (status !== 'pending') {
        throw conflict(
          'invite-not-pending',
          `This invitation is ${status} and cannot be confirmed.`,
        );
      }

      const invitee = await deps.findUserByEmail(invite.email);

      if (invitee === null) {
        throw conflict(
          'invitee-has-no-account',
          'That person has not signed in to Upskills yet, so there is no account to add. Their invitation link still works.',
        );
      }

      // No `email` here: the admin has already decided who this is, and the
      // address on the invitation is the one the account was found by.
      const { org } = await deps.acceptOrgInvite(inviteId, {
        uid: invitee.uid,
        acceptedByAdmin: uid,
      });

      return await answer(deps, org);
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/** The org id from the path, or a 400 — never an empty segment. */
function requireOrgId(event: H3Event): string {
  const orgId = getRouterParam(event, 'orgId');

  if (orgId === undefined || orgId === '') {
    throw badRequest(
      'invalid-org-id',
      'Expected a non-empty orgId route parameter.',
    );
  }

  return orgId;
}

/** The invite id from the body, or a 400. */
function readInviteId(body: unknown): string {
  const parsed = OrgInviteRefSchema.safeParse(body);

  if (!parsed.success) {
    throw badRequest(
      'invalid-invite',
      'Expected a JSON body of the form { "inviteId": "…" }.',
    );
  }

  return parsed.data.inviteId;
}

/**
 * The invitation, if it belongs to this org.
 *
 * An invitation of another org answers the same 404 as one that does not exist,
 * so an id cannot be used to probe which invitations are outstanding elsewhere.
 */
async function requireInviteOfOrg(
  deps: { getOrgInvite(inviteId: string): Promise<OrgInvite | null> },
  inviteId: string,
  orgId: string,
): Promise<OrgInvite> {
  const invite = await deps.getOrgInvite(inviteId);

  if (invite === null || invite.orgId !== orgId) {
    throw notFound('invite-not-found', 'No such invitation.');
  }

  return invite;
}

/**
 * Rejects re-inviting somebody who is already on the roster.
 *
 * Without this, inviting an existing member would mail them a link that, once
 * accepted, silently changes their role — a role change wearing an invitation's
 * clothes. Changing a member's role is what the members route is for.
 */
async function rejectIfAlreadyMember<TOrg>(
  deps: OrgInvitesBaseDeps<TOrg>,
  org: Organizer,
  email: string,
): Promise<void> {
  const emails = await deps.getUserEmails(Object.keys(org.members));

  if (Object.values(emails).includes(email)) {
    throw conflict(
      'already-a-member',
      'That person is already on this organizer. Change their role from the roster instead.',
    );
  }
}

/** `{ org, invites }` — the roster and its outstanding invitations. */
async function answer<TOrg>(
  deps: OrgInvitesBaseDeps<TOrg>,
  org: Organizer,
): Promise<OrgInvitesResponse<TOrg>> {
  // Both reads run after a durable write, so neither may fail the request —
  // see `member-emails.ts`. A degraded answer names uids or omits the invite
  // list; it never reports a committed invitation as a failure.
  const [emails, invites] = await Promise.all([
    emailsAfterWrite(deps.getUserEmails, Object.keys(org.members)),
    listAfterWrite(deps.listOrgInvites, org.orgId),
  ]);

  return {
    org: deps.serializeOrg(org, emails),
    invites: invites.map((invite) =>
      toOrgInviteView(invite, deps.orgInviteStatus(invite)),
    ),
  };
}
