import type { OrgRole } from '@upskills/models';
import { inviteUrl } from '../format';
import { composeMessage } from '../layout';
import { sendEmail, type EmailMessage, type SendResult } from '../send';

/**
 * The staff invitation.
 *
 * This is the one email in the app that carries a credential granting access to
 * someone else's data: whoever holds the link can join the organizer as staff.
 * It therefore names the org and the role in the body, so a recipient who was
 * not expecting it can see exactly what they are being offered before clicking,
 * and can ignore it if the invitation is not one they wanted.
 */

/** How each role reads to somebody who has never seen the app. */
const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin — full access, including managing staff',
  manager: 'Manager — create and run events',
  check_in: 'Check-in — check guests in at the door',
  volunteer: 'Volunteer — help out at events',
};

export interface OrgInviteEmailDetails {
  /** Where the invitation is going. */
  email: string;
  /** The organizer doing the inviting, by name. */
  orgName: string;
  role: OrgRole;
  /** The invitation's secret token — see `OrgInvite.token`. */
  token: string;
  /** When the link stops working. */
  expiresAt: Date;
  /** Who sent it, for the "was I expecting this?" question. */
  invitedByName?: string;
}

/** Invite someone to join an organizer as staff. */
export function renderOrgInviteEmail(
  details: OrgInviteEmailDetails,
): EmailMessage {
  const from =
    details.invitedByName === undefined || details.invitedByName === ''
      ? details.orgName
      : `${details.invitedByName} (${details.orgName})`;

  return composeMessage(
    details.email,
    `You've been invited to join ${details.orgName} on Upskills`,
    {
      preheader: `Accept your invitation to help run events for ${details.orgName}.`,
      heading: `Join ${details.orgName}`,
      paragraphs: [
        `${from} invited you to join ${details.orgName} on Upskills Network as staff.`,
        'Accepting takes you to Upskills, where you sign in with this email address to confirm. You are not added to the organizer until you do.',
      ],
      facts: [
        { label: 'Organizer', value: details.orgName },
        { label: 'Your role', value: ROLE_LABELS[details.role] },
        { label: 'Invitation expires', value: formatExpiry(details.expiresAt) },
      ],
      action: { label: 'Accept invitation', url: inviteUrl(details.token) },
      notes: [
        {
          text: "If you weren't expecting this invitation, you can ignore this email — nothing happens until you accept.",
        },
      ],
    },
  );
}

/** {@link renderOrgInviteEmail}, sent. Returns a result; never throws. */
export function sendOrgInviteEmail(
  details: OrgInviteEmailDetails,
): Promise<SendResult> {
  return sendEmail(renderOrgInviteEmail(details));
}

/**
 * The expiry date, in the same locale the rest of the emails use.
 *
 * Deliberately a *date*, not a timestamp: an invitation is good for days, so
 * naming the hour would suggest a precision the recipient has no reason to
 * plan around.
 */
function formatExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(expiresAt);
}
