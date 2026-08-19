import type { OrgInvite, OrgInviteStatus, OrgRole } from '@upskills/models';

/**
 * The projection every invite-bearing response answers with.
 *
 * ## What is deliberately missing
 *
 * `OrgInvite.token`. It is the credential that accepts the invitation, it
 * travels in the email and nowhere else, and a roster response is read by every
 * org admin and cached by every browser in between. Leaving it out means
 * listing invitations cannot leak the thing that redeems one — the roster
 * manages invites by `inviteId`, which grants nothing on its own.
 *
 * `status` is computed at serialization time rather than stored, because
 * `expired` is a fact about the clock: nothing runs at the moment an invitation
 * lapses, so the only honest answer is the one derived when the question is
 * asked. Timestamps are ISO-8601 for the same reason the org projections
 * convert theirs — a Firestore `Timestamp` does not survive JSON with its
 * `toDate()` intact.
 */
export interface OrgInviteView {
  inviteId: string;
  /** The invited address, shown so an admin can see who is outstanding. */
  email: string;
  role: OrgRole;
  status: OrgInviteStatus;
  /** ISO-8601. */
  invitedAt: string;
  /** ISO-8601. */
  expiresAt: string;
}

/** Serialize one invitation for a browser, token withheld. */
export function toOrgInviteView(
  invite: OrgInvite,
  status: OrgInviteStatus,
): OrgInviteView {
  return {
    inviteId: invite.inviteId,
    email: invite.email,
    role: invite.role,
    status,
    invitedAt: invite.createdAt.toDate().toISOString(),
    expiresAt: invite.expiresAt.toDate().toISOString(),
  };
}
