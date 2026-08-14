import type { Guest, WorkshopEvent } from '@upskills/models';
import {
  cancelUrl,
  eventUrl,
  formatEventDay,
  formatEventWhen,
  formatMoney,
  formatPrice,
  greetingName,
} from '../format';
import { composeMessage } from '../layout';
import { sendEmail, type EmailMessage, type SendResult } from '../send';

/**
 * The six emails a guest gets across the life of a registration.
 *
 * ## Rendering and sending are separate on purpose
 *
 * Each template comes in two halves: a `render…` that turns models into an
 * {@link EmailMessage} and a `send…` that hands that message to
 * {@link sendEmail}. Nothing in the `render…` half touches the network, reads a
 * credential, or can fail.
 *
 * That split is what makes this library testable today. The sending domain is
 * not verified yet — until it is, Resend will only deliver to the account
 * owner's own address, so "send it and look at it" is not available for any of
 * these. The renderers are: a test asserts the exact date a guest will see, and
 * a preview harness can dump the HTML to a file and open it in three mail
 * clients, all before a single DNS record exists. It also means a template bug
 * is caught by a unit test rather than by a guest.
 *
 * ## The cancel link
 *
 * Every email here that leaves a registration standing carries the guest's
 * personal cancel link, token included — see `cancelUrl`. A guest has no
 * account, so if the link is not in the mail there is no way to release a spot
 * short of emailing a human. The three that omit it are the ones with nothing
 * left to cancel: the cancellation confirmation and the sold-out refund, where
 * the registration is already gone.
 *
 * ## Paid registrations are not refunded on cancellation
 *
 * That is the confirmed policy, and a guest who discovers it *after* clicking
 * cancel is a support complaint and a chargeback. So it is stated up front in
 * the welcome and receipt emails, and again in the cancellation confirmation —
 * three chances to read it before it matters, rather than one after.
 */

/** Where a guest is told to look when the organizer has not set a location. */
const LOCATION_TBA = 'To be announced';

/**
 * Registration confirmed — the guest holds a spot.
 *
 * Sent on the free path once `reserveSpot` commits a `confirmed` guest, and on
 * the paid path once the Stripe webhook confirms the hold.
 */
export function renderWelcomeEmail(
  guest: Guest,
  event: WorkshopEvent,
): EmailMessage {
  const paid = (guest.amountPaid ?? 0) > 0;

  return composeMessage(
    guest.email,
    `You're registered for ${event.title}`,
    {
      preheader: `Your spot is confirmed for ${formatEventDay(event)}.`,
      heading: `You're in, ${greetingName(guest)}`,
      paragraphs: [
        `Your spot at ${event.title} is confirmed. Here are the details.`,
      ],
      facts: [
        { label: 'Event', value: event.title },
        { label: 'When', value: formatEventWhen(event) },
        { label: 'Where', value: event.location ?? LOCATION_TBA },
        paid
          ? {
              label: 'Paid',
              value: formatMoney(guest.amountPaid ?? 0, event.currency),
            }
          : { label: 'Cost', value: formatPrice(event) },
      ],
      action: { label: 'View event details', url: eventUrl(event) },
      notes: [
        { text: "Can't make it? Release your spot here:", url: cancelUrl(guest) },
        ...(paid ? [{ text: REFUND_POLICY }] : []),
      ],
    },
  );
}

/** {@link renderWelcomeEmail}, sent. Returns a result; never throws. */
export function sendWelcomeEmail(
  guest: Guest,
  event: WorkshopEvent,
): Promise<SendResult> {
  return sendEmail(renderWelcomeEmail(guest, event));
}

/**
 * The event was full — the guest is queued, not registered.
 *
 * ## The one thing this email must not do
 *
 * It must not read like a confirmation. A waitlisted guest who skims a friendly
 * "thanks for registering" and turns up on the night has been actively misled by
 * us, and there is no recovering that at the door. So the heading leads with the
 * position, the first sentence says the event is full, and the words that mean a
 * seat — confirmed, registered, you're in — appear nowhere in the copy.
 *
 * `position` is passed in rather than read off `guest.waitlistPosition` because
 * the caller has the authoritative value from the transaction that just
 * committed, and the in-memory guest it was built from may predate it.
 */
export function renderWaitlistEmail(
  guest: Guest,
  event: WorkshopEvent,
  position: number,
): EmailMessage {
  return composeMessage(
    guest.email,
    `You're on the waitlist for ${event.title}`,
    {
      preheader: `${event.title} is full. You're number ${position} in line.`,
      heading: `You're number ${position} on the waitlist`,
      paragraphs: [
        `${event.title} is full, so we've added you to the waitlist. This is not a spot at the event — you'll only have one if someone ahead of you cancels and we email you to say so.`,
        'You do not need to do anything now, and there is nothing to pay unless a spot opens.',
      ],
      facts: [
        { label: 'Event', value: event.title },
        { label: 'When', value: formatEventWhen(event) },
        { label: 'Where', value: event.location ?? LOCATION_TBA },
        { label: 'Waitlist position', value: `${position}` },
      ],
      action: { label: 'View event details', url: eventUrl(event) },
      notes: [
        {
          text: 'Changed your mind? Leave the waitlist here:',
          url: cancelUrl(guest),
        },
      ],
    },
  );
}

/** {@link renderWaitlistEmail}, sent. Returns a result; never throws. */
export function sendWaitlistEmail(
  guest: Guest,
  event: WorkshopEvent,
  position: number,
): Promise<SendResult> {
  return sendEmail(renderWaitlistEmail(guest, event, position));
}

/**
 * Promoted off the waitlist — the guest now holds a spot.
 *
 * Sent after `promoteNextPending` commits. It is the first email in the flow the
 * guest did not ask for, so it says plainly what changed and gives them an
 * immediate way out: someone who waitlisted six weeks ago may well have made
 * other plans, and the faster they can release the spot the sooner it reaches
 * the next person in line.
 */
export function renderSpotOpenedEmail(
  guest: Guest,
  event: WorkshopEvent,
): EmailMessage {
  return composeMessage(
    guest.email,
    `A spot opened up — you're registered for ${event.title}`,
    {
      preheader: `You're off the waitlist. Your spot on ${formatEventDay(
        event,
      )} is confirmed.`,
      heading: 'A spot opened up',
      paragraphs: [
        `Good news, ${greetingName(
          guest,
        )} — someone cancelled, so you've moved off the waitlist and your spot at ${
          event.title
        } is confirmed.`,
      ],
      facts: [
        { label: 'Event', value: event.title },
        { label: 'When', value: formatEventWhen(event) },
        { label: 'Where', value: event.location ?? LOCATION_TBA },
      ],
      action: { label: 'View event details', url: eventUrl(event) },
      notes: [
        {
          text: 'If your plans have changed, release the spot here so it can go to the next person:',
          url: cancelUrl(guest),
        },
      ],
    },
  );
}

/** {@link renderSpotOpenedEmail}, sent. Returns a result; never throws. */
export function sendSpotOpenedEmail(
  guest: Guest,
  event: WorkshopEvent,
): Promise<SendResult> {
  return sendEmail(renderSpotOpenedEmail(guest, event));
}

/**
 * The registration is gone — cancelled by the guest or by the organizer.
 *
 * ## Why the refund sentence is the point of this email
 *
 * Cancelling a paid registration releases the spot and refunds nothing. The
 * event page says so before checkout and the confirmation says so again, but
 * this is the message a guest reads *while* wondering where their money went,
 * and if it is not answered here it becomes an email to support or a dispute
 * with the card issuer. So it is stated in the body, in plain words, with the
 * amount, and it points at the organizer — who is the only party that can
 * actually issue one.
 *
 * The sentence appears whenever money was involved: either this guest paid, or
 * the event has a price and the payment record is not on the document we were
 * handed. Saying it to someone who registered for a free event would be
 * confusing noise, so a genuinely free registration does not get it.
 */
export function renderCancellationEmail(
  guest: Guest,
  event: WorkshopEvent,
): EmailMessage {
  const amountPaid = guest.amountPaid ?? 0;
  const involvedMoney = amountPaid > 0 || event.price > 0;

  const paragraphs = [
    `Your registration for ${event.title} has been cancelled and your spot has been released.`,
  ];

  if (involvedMoney) {
    paragraphs.push(
      amountPaid > 0
        ? `Your payment of ${formatMoney(
            amountPaid,
            event.currency,
          )} has not been refunded. Cancelling releases the spot but does not return the payment. Refunds are at the organizer's discretion — reply to this email to ask them about one.`
        : `Any payment you made for this event has not been refunded. Cancelling releases the spot but does not return the payment. Refunds are at the organizer's discretion — reply to this email to ask them about one.`,
    );
  }

  paragraphs.push(
    'If this was a mistake, you can register again from the event page — though the spot may already have gone to someone on the waitlist.',
  );

  return composeMessage(guest.email, `Your registration for ${event.title} is cancelled`, {
    preheader: `Your spot at ${event.title} has been released.`,
    heading: 'Your registration is cancelled',
    paragraphs,
    facts: [
      { label: 'Event', value: event.title },
      { label: 'When', value: formatEventWhen(event) },
      ...(amountPaid > 0
        ? [
            {
              label: 'Paid',
              value: `${formatMoney(amountPaid, event.currency)} (not refunded)`,
            },
          ]
        : []),
    ],
    action: { label: 'View event details', url: eventUrl(event) },
  });
}

/** {@link renderCancellationEmail}, sent. Returns a result; never throws. */
export function sendCancellationEmail(
  guest: Guest,
  event: WorkshopEvent,
): Promise<SendResult> {
  return sendEmail(renderCancellationEmail(guest, event));
}

/**
 * The receipt for a paid registration.
 *
 * Sent alongside the welcome email on the paid path, and kept separate from it
 * so a guest can forward the money part to an employer without forwarding the
 * cancel link with it.
 *
 * The Stripe payment intent is printed as the reference: it is the id an
 * organizer can find in their dashboard and the one a refund is issued against,
 * which is the only reason a guest would ever quote it back at us.
 */
export function renderPaymentReceiptEmail(
  guest: Guest,
  event: WorkshopEvent,
): EmailMessage {
  const amountPaid = guest.amountPaid ?? event.price;
  const reference = guest.stripePaymentIntentId ?? guest.stripeSessionId;

  return composeMessage(guest.email, `Receipt for ${event.title}`, {
    preheader: `${formatMoney(amountPaid, event.currency)} paid for ${
      event.title
    }.`,
    heading: 'Your receipt',
    paragraphs: [
      `Thanks, ${greetingName(guest)} — your payment for ${
        event.title
      } went through. Keep this for your records.`,
    ],
    facts: [
      { label: 'Amount', value: formatMoney(amountPaid, event.currency) },
      { label: 'Event', value: event.title },
      { label: 'When', value: formatEventWhen(event) },
      { label: 'Where', value: event.location ?? LOCATION_TBA },
      { label: 'Billed to', value: guest.email },
      ...(reference ? [{ label: 'Reference', value: reference }] : []),
    ],
    action: { label: 'View event details', url: eventUrl(event) },
    notes: [
      { text: REFUND_POLICY },
      { text: 'To release your spot, use this link:', url: cancelUrl(guest) },
    ],
  });
}

/** {@link renderPaymentReceiptEmail}, sent. Returns a result; never throws. */
export function sendPaymentReceiptEmail(
  guest: Guest,
  event: WorkshopEvent,
): Promise<SendResult> {
  return sendEmail(renderPaymentReceiptEmail(guest, event));
}

/**
 * Paid, but the last spot went first — the payment has been refunded.
 *
 * The narrow window this covers: a hold was released, the freed spot was taken
 * by someone else, and only then did this guest's payment land. They are not
 * registered and never were, so there is no spot and no cancel link — only the
 * refund and the waitlist.
 *
 * This is the one email in the set that reports something going wrong on our
 * side, so it says what happened without hedging and confirms the refund is
 * already in motion rather than inviting the guest to ask for one.
 */
export function renderSoldOutRefundEmail(
  guest: Guest,
  event: WorkshopEvent,
): EmailMessage {
  const amountPaid = guest.amountPaid ?? event.price;

  return composeMessage(
    guest.email,
    `${event.title} sold out — your payment has been refunded`,
    {
      preheader: `We couldn't hold your spot. ${formatMoney(
        amountPaid,
        event.currency,
      )} is on its way back to you.`,
      heading: 'We could not hold your spot',
      paragraphs: [
        `Sorry, ${greetingName(guest)} — the last spot at ${
          event.title
        } was taken before your payment finished going through. You are not registered for this event.`,
        `We have refunded ${formatMoney(
          amountPaid,
          event.currency,
        )} in full. Refunds usually take five to ten business days to appear on your statement, depending on your bank.`,
        'If a spot opens up you are welcome to register again from the event page.',
      ],
      facts: [
        { label: 'Event', value: event.title },
        { label: 'When', value: formatEventWhen(event) },
        {
          label: 'Refunded',
          value: formatMoney(amountPaid, event.currency),
        },
      ],
      action: { label: 'View event details', url: eventUrl(event) },
    },
  );
}

/** {@link renderSoldOutRefundEmail}, sent. Returns a result; never throws. */
export function sendSoldOutRefundEmail(
  guest: Guest,
  event: WorkshopEvent,
): Promise<SendResult> {
  return sendEmail(renderSoldOutRefundEmail(guest, event));
}

/**
 * The refund policy, worded identically wherever it appears.
 *
 * One constant rather than three sentences that mean roughly the same thing: a
 * policy a guest can quote back at us has to read the same in the confirmation
 * as it does in the receipt, and copy that is retyped per template drifts.
 */
const REFUND_POLICY =
  'Cancelling releases your spot but does not refund your payment. Contact the organizer if you need to ask about a refund.';
