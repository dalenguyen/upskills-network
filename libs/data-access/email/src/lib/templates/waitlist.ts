import { siteUrl } from '../config';
import { composeMessage } from '../layout';
import { sendEmail, type EmailMessage, type SendResult } from '../send';

/**
 * The landing-page waitlist confirmation.
 *
 * This is deliberately separate from `renderWaitlistEmail` in `guest.ts`. That
 * template is for an *event* waitlist — a guest who registered for a full
 * workshop and holds status `pending` until a seat frees up. This one is for a
 * visitor who left an email address on the landing page. There is no event and
 * no guest document yet; the only thing the caller knows is the address, and
 * this email confirms that the address is on the list.
 */

/** Confirm a landing-page waitlist signup. */
export function renderWaitlistConfirmationEmail(email: string): EmailMessage {
  return composeMessage(email, `You're on the Upskills waitlist`, {
    preheader:
      'Thanks for signing up — we will email you when early access opens.',
    heading: "You're on the waitlist",
    paragraphs: [
      `Thanks for signing up for early access to Upskills Network. We've added ${email} to the waitlist.`,
      "You don't need to do anything now. We'll email you as soon as a spot opens up.",
    ],
    facts: [{ label: 'Email', value: email }],
    action: { label: 'Visit Upskills', url: siteUrl() },
  });
}

/** {@link renderWaitlistConfirmationEmail}, sent. Returns a result; never throws. */
export function sendWaitlistConfirmationEmail(
  email: string,
): Promise<SendResult> {
  return sendEmail(renderWaitlistConfirmationEmail(email));
}
