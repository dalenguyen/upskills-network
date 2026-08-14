# data-access-email

Transactional email for the workshop platform, over [Resend](https://resend.com).
Imported as `@upskills/email`.

## The rule

**Send helpers return a result; they never throw.**

A Resend outage must not roll back a confirmed registration or a captured
payment. Every helper answers with a `SendResult`:

```ts
type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: SendFailureReason; detail: string };
```

Callers send **after** the transaction commits, never inside one, and log what
comes back. A failure is also logged by the library itself, with the recipient,
the subject and the cause, so a dropped result still leaves enough to re-send by
hand.

`reason` distinguishes what to do next: `not_configured` (fix the deployment),
`rejected` (the address or payload is bad — a retry fails the same way),
`throttled` (retry later), `unavailable` (retry the same message).

## Rendering and sending are separate

Each template is a `render…` returning an `EmailMessage`, and a `send…` that
hands it to `sendEmail`. Nothing in a `render…` touches the network or needs a
credential, so the copy is testable and previewable before the sending domain is
verified.

```ts
const message = renderWelcomeEmail(guest, event); // pure
const result = await sendWelcomeEmail(guest, event); // renders, then sends
```

## Templates

Guest (issue #43): `WelcomeEmail`, `WaitlistEmail`, `SpotOpenedEmail`,
`CancellationEmail`, `PaymentReceiptEmail`, `SoldOutRefundEmail`.

Reminder + organizer (issue #44): `EventReminder`, `OrganizerNotification`.

Every guest email that leaves a registration standing carries the guest's cancel
link, token included. Dates render in `event.timezone`; amounts render as CAD.

## Configuration

All read lazily, at send time — importing this library never requires any of
them.

| Variable | Purpose | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | API key. Absent → `sent: false, reason: 'not_configured'`. | none |
| `EMAIL_FROM` | `From` header. | `Upskills Network <onboarding@resend.dev>` |
| `EMAIL_REPLY_TO` | `Reply-To`. The route back for "contact the organizer". | unset |
| `SITE_URL` | Origin every link is built against. | `http://localhost:4200` |

`onboarding@resend.dev` only delivers to the Resend account owner's own address.
Production must set `EMAIL_FROM` to the verified sending domain, and `SITE_URL`
to the real origin — otherwise guests get links to `localhost`.

## Tests

`nx test data-access-email`. No emulator, no credentials, no network: the Resend
client is replaced with `setEmailClient()`.
