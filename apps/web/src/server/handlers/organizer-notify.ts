import type {
  OrganizerNotificationDetails,
  OrganizerNotificationType,
  OrganizerRecipient,
} from '@upskills/email';
import type { Organizer, WorkshopEvent } from '@upskills/models';

/**
 * Turning an org id into the people who should hear about a registration.
 *
 * ## Why the resolution lives here and not in `@upskills/email`
 *
 * `sendOrganizerNotification` takes addresses because it cannot get them:
 * `Organizer.members` is keyed by uid, and the address behind a uid lives in
 * `users/{uid}`. Doing that lookup inside the email library would drag Firestore
 * into every template test. Doing it inside each route would repeat the same
 * four steps three times. So it happens once, here, on the server side of the
 * app where both libraries are already loaded.
 *
 * ## Why nothing in this file can fail its caller
 *
 * Every call site is post-commit. The seat is taken, the cancellation is
 * recorded, the guest has already been emailed. An organizer notification is the
 * least important thing on that path and the most likely to break — it reads two
 * more documents than the write did, and a missing org, a deleted user, or a
 * Resend outage would each throw. Any of those turning a committed registration
 * into a 500 would make the guest retry a registration that already succeeded.
 *
 * So the notifier swallows everything and returns `void`. There is deliberately
 * no result for the caller to inspect: nothing in the HTTP response should
 * change because an organizer's copy did or did not go out. What the guest is
 * told stays a function of the guest's own email.
 *
 * ## Why a missing address is skipped rather than guessed
 *
 * `getUserEmails` omits uids it cannot resolve — a member who never completed
 * signup, or a user document not yet backfilled. Those members are dropped from
 * the recipient list. The alternative, mailing a uid-shaped string, is a
 * guaranteed Resend rejection per send and a noisy log for no delivery.
 */

/** What a route needs from the outside world to notify an org's staff. */
export interface OrganizerNotifyDeps {
  /** `getOrg` from `@upskills/firestore`. */
  getOrg(orgId: string): Promise<Organizer | null>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
  /** `sendOrganizerNotification` from `@upskills/email`. Filters by role. */
  sendOrganizerNotification(
    recipients: readonly OrganizerRecipient[],
    event: WorkshopEvent,
    type: OrganizerNotificationType,
    details: OrganizerNotificationDetails,
  ): Promise<unknown>;
}

/**
 * The notifier a route hands to its handler.
 *
 * Resolves once per call rather than caching: a registration is not hot enough
 * for two extra reads to matter, and a cache would keep mailing a member who was
 * removed from the org an hour ago.
 */
export type NotifyOrganizers = (
  orgId: string,
  event: WorkshopEvent,
  type: OrganizerNotificationType,
  details?: OrganizerNotificationDetails,
) => Promise<void>;

/** Every member of `org` whose address is known, with the role they hold. */
export function recipientsOf(
  org: Organizer,
  emails: Record<string, string>,
): OrganizerRecipient[] {
  return Object.entries(org.members).flatMap(([uid, membership]) => {
    const email = emails[uid];

    return email === undefined ? [] : [{ email, role: membership.role }];
  });
}

/** Build the notifier. See the module comment for why it never rejects. */
export function createOrganizerNotifier(
  deps: OrganizerNotifyDeps,
): NotifyOrganizers {
  return async (orgId, event, type, details = {}) => {
    try {
      const org = await deps.getOrg(orgId);

      if (org === null) {
        return;
      }

      const uids = Object.keys(org.members);

      if (uids.length === 0) {
        return;
      }

      const recipients = recipientsOf(org, await deps.getUserEmails(uids));

      if (recipients.length === 0) {
        return;
      }

      await deps.sendOrganizerNotification(recipients, event, type, details);
    } catch {
      // Deliberately silent to the caller — see the module comment. The send
      // helper already reports per-recipient failures; what is swallowed here
      // is the lookup failing, which no HTTP response should reflect.
      return;
    }
  };
}
