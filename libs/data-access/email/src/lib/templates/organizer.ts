import type { Guest, OrgRole, WorkshopEvent } from '@upskills/models';
import {
  formatEventWhen,
  formatMoney,
  guestListUrl,
} from '../format';
import { composeMessage } from '../layout';
import { sendEmail, type EmailMessage, type SendResult } from '../send';

/**
 * What the people running an event hear about, and which of them hear it.
 *
 * ## Why the recipients are passed in rather than looked up
 *
 * `Organizer.members` is a map keyed by uid, and a uid is not an address —
 * the email lives in Firebase Auth, not in Firestore. Resolving it means an
 * Admin SDK call, which would make this library depend on `firebase-admin` and
 * make every template test need a credential. The caller is already holding the
 * org document and is already in a position to resolve its members, so it hands
 * over addresses and roles and this module decides who among them is relevant.
 *
 * ## Why every recipient gets their own message
 *
 * One email with five addresses in `to:` would be one API call instead of five,
 * and it is the wrong trade. A single rejected address fails the whole request,
 * so one volunteer with a typo'd address silences the notification for the four
 * admins who needed it. Per-recipient sends also give per-recipient results,
 * which is what makes the returned {@link FanOutResult} usable for a retry —
 * and it keeps colleagues' addresses out of each other's headers.
 *
 * ## Nothing here throws either
 *
 * These fire on the same post-commit paths as the guest emails: a registration
 * has already been taken, a payment already captured. The fan-out collects
 * results and returns them; one failed recipient does not stop the others and
 * does not reach the caller as an exception.
 */

/** Something an organizer wants to know about, as it happens. */
export type OrganizerNotificationType =
  /** A guest took a spot. */
  | 'registration'
  /** A guest joined the waitlist — the event is full. */
  | 'waitlist_joined'
  /** A guest released a spot. Usually paired with a waitlist promotion. */
  | 'cancellation'
  /** The last spot went. Nobody else can register without a cancellation. */
  | 'sold_out'
  /** A paid registration cleared Stripe. */
  | 'payment_received'
  /** A refund was issued for a paid registration. */
  | 'refund_issued';

/** One person who might be told, with the role they hold in the org. */
export interface OrganizerRecipient {
  readonly email: string;
  readonly name?: string;
  readonly role: OrgRole;
}

/**
 * The guest the notification is about, when there is one.
 *
 * Optional because `sold_out` is about the event rather than any one person. The
 * ticket's signature is `(orgMembers, event, type)`; this fourth argument is an
 * addition, because "someone cancelled" is a notification an organizer has to go
 * and investigate, while "Priya Raman cancelled" is one they can act on.
 */
export interface OrganizerNotificationDetails {
  readonly guest?: Pick<
    Guest,
    'name' | 'email' | 'amountPaid' | 'waitlistPosition'
  >;
}

/**
 * Which roles are told about what.
 *
 * `admin` and `manager` run the event and own its money, so they get
 * everything. `check_in` exists to work the door on the day and `volunteer` is
 * read-only; neither can act on a registration or a refund, and mailing them
 * every signup is how a team learns to filter the whole sender to a folder.
 *
 * A map rather than a hardcoded pair so that adding a type forces a decision
 * about who hears it, and widening one type later is a one-line change.
 */
const ROLES_NOTIFIED: Record<
  OrganizerNotificationType,
  readonly OrgRole[]
> = {
  registration: ['admin', 'manager'],
  waitlist_joined: ['admin', 'manager'],
  cancellation: ['admin', 'manager'],
  sold_out: ['admin', 'manager'],
  payment_received: ['admin', 'manager'],
  refund_issued: ['admin', 'manager'],
};

/** One recipient's outcome, with the address so a failure can be chased. */
export type AddressedSendResult = SendResult & { readonly to: string };

/** What one fan-out did. Reported, never thrown. */
export interface FanOutResult {
  /** How many recipients the role filter selected. Zero is a valid answer. */
  readonly recipients: number;
  /** How many of those Resend accepted. */
  readonly sent: number;
  /** One entry per selected recipient, in the order they were mailed. */
  readonly results: readonly AddressedSendResult[];
}

/**
 * Tell the relevant members of an organizer about something that happened.
 *
 * ```ts
 * // After the transaction commits — never inside it.
 * await sendOrganizerNotification(members, event, 'registration', { guest });
 * ```
 *
 * Recipients are filtered by role and de-duplicated by address before anything
 * is sent: the same person can appear twice in a caller's list, and a duplicate
 * would mean two identical emails about one registration.
 */
export async function sendOrganizerNotification(
  orgMembers: readonly OrganizerRecipient[],
  event: WorkshopEvent,
  type: OrganizerNotificationType,
  details: OrganizerNotificationDetails = {},
): Promise<FanOutResult> {
  const recipients = selectRecipients(orgMembers, type);
  const results: AddressedSendResult[] = [];

  for (const recipient of recipients) {
    const result = await sendEmail(
      renderOrganizerNotification(recipient.email, event, type, details),
    );
    results.push({ ...result, to: recipient.email });
  }

  return {
    recipients: recipients.length,
    sent: results.filter((result) => result.sent).length,
    results,
  };
}

/**
 * The notification as one organizer will read it.
 *
 * Separate from the send so the copy for all six types is testable without a
 * client, the same way the guest templates are.
 */
export function renderOrganizerNotification(
  to: string,
  event: WorkshopEvent,
  type: OrganizerNotificationType,
  details: OrganizerNotificationDetails = {},
): EmailMessage {
  const { guest } = details;
  const who = guest ? `${guest.name} (${guest.email})` : 'A guest';
  const copy = describe(type, event, who, guest?.waitlistPosition);

  const amount = guest?.amountPaid;
  const showsAmount =
    (type === 'payment_received' || type === 'refund_issued') &&
    amount !== undefined;

  return composeMessage(to, `${copy.subject} — ${event.title}`, {
    preheader: copy.body,
    heading: copy.subject,
    paragraphs: [copy.body],
    facts: [
      { label: 'Event', value: event.title },
      { label: 'When', value: formatEventWhen(event) },
      ...(guest ? [{ label: 'Guest', value: who }] : []),
      ...(showsAmount
        ? [
            {
              label: type === 'refund_issued' ? 'Refunded' : 'Amount',
              value: formatMoney(amount, event.currency),
            },
          ]
        : []),
      { label: 'Confirmed', value: capacityLine(event) },
      { label: 'Waitlist', value: `${event.pendingCount}` },
    ],
    action: { label: 'Open the guest list', url: guestListUrl(event) },
  });
}

/**
 * Subject and body for each type.
 *
 * A `switch` with no default and an exhaustive return, so adding a type to
 * {@link OrganizerNotificationType} fails the build here rather than shipping a
 * notification with an empty subject.
 */
function describe(
  type: OrganizerNotificationType,
  event: WorkshopEvent,
  who: string,
  waitlistPosition: number | undefined,
): { subject: string; body: string } {
  switch (type) {
    case 'registration':
      return {
        subject: 'New registration',
        body: `${who} took a spot at ${event.title}.`,
      };
    case 'waitlist_joined':
      return {
        subject: 'New waitlist entry',
        body: `${who} joined the waitlist for ${event.title}${
          waitlistPosition === undefined ? '' : ` at position ${waitlistPosition}`
        }. The event is full.`,
      };
    case 'cancellation':
      return {
        subject: 'Registration cancelled',
        body: `${who} cancelled and released a spot at ${event.title}. If anyone was waiting, the next person has been promoted automatically.`,
      };
    case 'sold_out':
      return {
        subject: 'Event is sold out',
        body: `${event.title} has filled its last spot. New registrations will go to the waitlist until someone cancels.`,
      };
    case 'payment_received':
      return {
        subject: 'Payment received',
        body: `${who} paid for a spot at ${event.title}.`,
      };
    case 'refund_issued':
      return {
        subject: 'Refund issued',
        body: `A refund was issued to ${who} for ${event.title}. Their spot has been released.`,
      };
  }
}

/** `12 of 30`, or a bare count when the event has no capacity limit. */
function capacityLine(event: WorkshopEvent): string {
  return event.maxGuests > 0
    ? `${event.confirmedCount} of ${event.maxGuests}`
    : `${event.confirmedCount} (no limit)`;
}

/**
 * The members who should hear about `type`, each appearing once.
 *
 * De-duplication is case-insensitive because addresses are, and because the
 * caller's list is assembled from a membership map whose emails did not
 * necessarily come from `normalizeEmail`.
 */
function selectRecipients(
  orgMembers: readonly OrganizerRecipient[],
  type: OrganizerNotificationType,
): OrganizerRecipient[] {
  const roles = ROLES_NOTIFIED[type];
  const seen = new Set<string>();
  const selected: OrganizerRecipient[] = [];

  for (const member of orgMembers) {
    const address = member.email.trim();
    const key = address.toLowerCase();

    if (address === '' || seen.has(key) || !roles.includes(member.role)) {
      continue;
    }

    seen.add(key);
    selected.push({ ...member, email: address });
  }

  return selected;
}
