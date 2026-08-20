import type { Guest, WorkshopEvent } from '@upskills/models';
import {
  cancelUrl,
  eventUrl,
  formatEventDay,
  formatEventWhen,
  greetingName,
} from '../format';
import { composeMessage } from '../layout';
import { sendEmail, type EmailMessage, type SendResult } from '../send';

/**
 * The nudge a confirmed guest gets shortly before the event.
 *
 * ## What this module deliberately does not do
 *
 * It does not decide *when* to send, and it does not check `reminderSentAt`.
 *
 * The reminder sweep runs over an event's whole guest list — Cloud Scheduler
 * hits `tasks/send-reminders.post.ts`, which selects events starting within 24
 * hours whose `reminderSentAt` is unset, mails every confirmed guest, and stamps
 * the field once. The guard belongs there, on the event, in the same transaction
 * that claims the sweep, because that is the only place it can be atomic.
 *
 * Checking `event.reminderSentAt` here instead would be worse than useless. The
 * sweep passes the *same* event object to every guest, so the field either reads
 * unset for all of them (guarding nothing) or set for all of them (suppressing
 * the entire mailing). A per-guest check cannot distinguish "this event's
 * reminders already went out" from "this event's reminders are going out right
 * now", which is precisely the distinction the field exists to make. So the
 * de-duplication is the caller's, and this module's job is to render one good
 * email.
 *
 * ## Why the cancel link is on the reminder too
 *
 * A day out is when people realise they cannot make it, and it is the last
 * useful moment to free a spot for the waitlist. A reminder that only says "see
 * you tomorrow" turns every change of plan into a no-show.
 */

/** Shown when the organizer has not set a location. */
const LOCATION_TBA = 'To be announced — check the event page';

/**
 * Reminder for a confirmed guest.
 *
 * Time and place come first because they are the only reason the email is
 * opened, and both are rendered in the event's own time zone.
 */
export function renderEventReminder(
  guest: Guest,
  event: WorkshopEvent,
  orgSlug: string,
): EmailMessage {
  return composeMessage(
    guest.email,
    `Reminder: ${event.title} is on ${formatEventDay(event)}`,
    {
      preheader: `${formatEventWhen(event)} · ${
        event.location ?? LOCATION_TBA
      }`,
      heading: `${event.title} is coming up`,
      paragraphs: [
        `Hi ${greetingName(
          guest,
        )} — this is a reminder that you have a confirmed spot at ${
          event.title
        }. Here is where and when to be.`,
      ],
      facts: [
        { label: 'Event', value: event.title },
        { label: 'When', value: formatEventWhen(event) },
        { label: 'Where', value: event.location ?? LOCATION_TBA },
      ],
      action: { label: 'View event details', url: eventUrl(event, orgSlug) },
      notes: [
        {
          text: 'If you can no longer make it, please release your spot so someone on the waitlist can take it:',
          url: cancelUrl(guest),
        },
      ],
    },
  );
}

/** {@link renderEventReminder}, sent. Returns a result; never throws. */
export function sendEventReminder(
  guest: Guest,
  event: WorkshopEvent,
  orgSlug: string,
): Promise<SendResult> {
  return sendEmail(renderEventReminder(guest, event, orgSlug));
}
