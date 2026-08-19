import type { OrgRole } from './organizer';
import type { Timestamp } from './timestamp';

/**
 * An invitation to join an organizer: `orgInvites/{inviteId}`.
 *
 * ## Why membership is not written when the invite is created
 *
 * An invite is an offer, not a membership. Nothing lands in
 * `Organizer.members` until the invitee accepts, so a pending invite grants no
 * access at all — the security rules keep reading `members[request.auth.uid]`
 * and see nothing. That also means an invite can name an email address with no
 * account behind it yet: there is no uid to key a membership by until someone
 * signs in and accepts.
 *
 * ## Why the document id is not the token
 *
 * `inviteId` is the handle the roster manages an invite by (revoke, resend,
 * accept-on-behalf) and it travels to every org admin. {@link OrgInvite.token}
 * is the secret that travels in the email and is the *only* thing standing
 * between a stranger and joining an org, so it is a separate random value that
 * is never included in a roster response. Keeping them apart means listing
 * invites cannot leak the credential that accepts one.
 */
export interface OrgInvite {
  /** Document id — the handle org admins manage the invite by. */
  inviteId: string;
  orgId: string;
  /** Normalized, as everywhere else an email is stored. */
  email: string;
  /** The role the invitee gets on acceptance. */
  role: OrgRole;
  /** Secret bearer credential; travels only in the invitation email. */
  token: string;
  /** uid of the admin who sent the invitation. */
  invitedBy: string;
  createdAt: Timestamp;
  /** After this, the token no longer accepts — see `INVITE_TTL_DAYS`. */
  expiresAt: Timestamp;
  /** Set when the invite was accepted; absent while it is outstanding. */
  acceptedAt?: Timestamp;
  /** uid the membership was written for — the invitee's own. */
  acceptedBy?: string;
  /**
   * uid of the org admin who accepted on the invitee's behalf, when an admin
   * confirmed the person out-of-band rather than waiting for the email click.
   * Absent when the invitee accepted the invitation themselves.
   */
  acceptedByAdmin?: string;
  /** Set when an admin withdrew the invitation. */
  revokedAt?: Timestamp;
}

/**
 * What an invite is doing right now.
 *
 * Derived from the timestamps rather than stored: a stored status would need a
 * write at the moment an invite expires, and nothing is running at that moment.
 * `expired` is therefore a function of `expiresAt` and the current clock — see
 * `orgInviteStatus`.
 */
export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
