import { getEmailClient } from './client';
import { fromAddress, replyToAddress } from './config';

/**
 * The send path, and the rule the whole library exists to enforce: **a send
 * never throws.**
 *
 * ## What goes wrong without it
 *
 * Registration is a Firestore transaction followed by an email. If the email
 * throws, the natural thing for a route handler to do is let it propagate, which
 * turns a delivered-and-committed registration into a 500 — and a guest who
 * reloads and registers again, or an organizer who sees a confirmed seat the
 * guest was told they did not get. On the paid path it is worse: the money is
 * already captured by the time the receipt is sent, and no exception thrown
 * afterwards can give it back. Resend is a third party with its own outages; it
 * cannot be allowed a vote on whether a committed registration stands.
 *
 * So every failure — an unconfigured process, a bounced address, a 500 from
 * Resend, a socket that dies mid-request — comes back as a {@link SendResult}
 * with `sent: false`. Callers send *after* the commit, log what came back, and
 * carry on.
 *
 * ## Why a discriminated result rather than a boolean
 *
 * The failures are not interchangeable. `rejected` means the address is bad and
 * retrying sends the same email into the same wall; `unavailable` means Resend
 * was down and this exact message should be retried; `throttled` means retry,
 * but later; `not_configured` means nobody was ever going to receive it and the
 * deployment is wrong. A boolean collapses all four into "it didn't work", which
 * is the one thing an operator already knows.
 *
 * ## The honest limitation
 *
 * TypeScript has no `#[must_use]`. `void sendWelcomeEmail(guest, event)` at a
 * call site compiles, and nothing in the type system can stop it. What this
 * module can do — and does — is make sure an ignored failure is never *silent*:
 * {@link sendEmail} logs every non-send itself, with the recipient, the subject,
 * and the reason, before returning. A caller that drops the result still leaves
 * an operator enough to find and re-send the message by hand, which is the
 * acceptance criterion in issue #42. Callers should still read the result; the
 * log is the backstop, not the plan.
 */

/** A rendered, ready-to-send message. Produced by the templates in this lib. */
export interface EmailMessage {
  /** Single recipient. Fan-out sends one message each — see `sendOrganizerNotification`. */
  readonly to: string;
  readonly subject: string;
  /** Table-based, inline-styled HTML. See `layout.ts`. */
  readonly html: string;
  /** The same content as plain text. Never omitted — see `renderText`. */
  readonly text: string;
  /** Overrides `EMAIL_REPLY_TO` for this message. */
  readonly replyTo?: string;
}

/**
 * Why a message was not sent.
 *
 * - `not_configured` — no `RESEND_API_KEY` in this process. Nothing was
 *   attempted. Fix the deployment; retrying changes nothing.
 * - `rejected` — Resend refused the request (4xx): an unroutable address, an
 *   unverified `From`, a malformed payload. Retrying the same message fails the
 *   same way.
 * - `throttled` — rate limit or quota (429, `*_quota_exceeded`). The message is
 *   fine; the account is over its allowance. Retry later.
 * - `unavailable` — Resend returned 5xx, or the request never completed (DNS,
 *   TLS, socket, timeout). Retry the same message.
 */
export type SendFailureReason =
  'not_configured' | 'rejected' | 'throttled' | 'unavailable';

/**
 * What one send did.
 *
 * The `sent` discriminant is what narrows: `result.id` only exists on the
 * success arm and `result.reason` only on the failure arm, so a caller cannot
 * read an id off a failed send or forget that failure has a shape.
 */
export type SendResult =
  | { readonly sent: true; readonly id: string }
  | {
      readonly sent: false;
      readonly reason: SendFailureReason;
      /** Human-readable cause, for the log line and for support. */
      readonly detail: string;
    };

/**
 * Deliver `message`, reporting the outcome instead of raising it.
 *
 * Call it **after** the transaction that made the email true has committed, and
 * never inside one — a Firestore transaction body may be retried, and a send
 * inside it would go out once per attempt.
 *
 * ```ts
 * const { guest } = await reserveSpot(eventId, draft, 'confirm');
 * // Committed. Nothing below this line can undo it.
 * const result = await sendWelcomeEmail(guest, event);
 * if (!result.sent) {
 *   // Already logged; this is where a retry queue would go.
 * }
 * ```
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const recipient = message.to.trim();

  // Checked before anything else because Resend answers a missing recipient
  // with a generic validation error, and "no recipient" is worth naming
  // precisely in a log an operator is reading at 2am.
  if (recipient === '') {
    return fail(message, 'rejected', 'No recipient address.');
  }

  // Everything below is inside the try, including building the client and
  // reading configuration. Those do not throw today — `new Resend(key)` only
  // rejects a falsy key, which is already guarded. But this function's whole
  // contract is that it never throws, and a contract that holds only because of
  // the current internals of a third-party constructor is not one a caller can
  // rely on. A Resend release that validates key *format* would otherwise turn
  // a misconfigured deploy into an exception on the paid path, which is exactly
  // the rollback this library exists to prevent.
  try {
    const client = getEmailClient();
    if (!client) {
      return fail(
        message,
        'not_configured',
        'RESEND_API_KEY is not set in this process; nothing was sent.',
      );
    }

    const replyTo = message.replyTo ?? replyToAddress();

    const response = await client.emails.send({
      from: fromAddress(),
      to: recipient,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(replyTo ? { replyTo } : {}),
    });

    if (response.error) {
      return fail(
        message,
        classify(response.error.statusCode, response.error.name),
        `${response.error.name}: ${response.error.message}`,
      );
    }

    if (!response.data?.id) {
      // Neither arm of the SDK's response union — a proxy or a gateway rewrote
      // the body. Treated as retryable because the request may never have
      // reached Resend at all.
      return fail(
        message,
        'unavailable',
        'Resend returned neither an id nor an error.',
      );
    }

    return { sent: true, id: response.data.id };
  } catch (error) {
    // The SDK reports API errors in the response body, so a throw here is the
    // request failing to complete: DNS, TLS, a dropped socket, an abort. All
    // retryable, none of them the message's fault.
    return fail(message, 'unavailable', describe(error));
  }
}

/**
 * gRPC-style status buckets, mapped from Resend's HTTP status and error name.
 *
 * The status code is authoritative when present; the name is the fallback,
 * because `statusCode` is typed `number | null` and has been observed null on
 * transport-adjacent errors. Anything unrecognised is treated as `unavailable`
 * — the retryable answer — since guessing `rejected` would drop a message that
 * a retry would have delivered.
 */
function classify(
  statusCode: number | null,
  name: string,
): SendFailureReason {
  if (name.endsWith('quota_exceeded') || name === 'rate_limit_exceeded') {
    return 'throttled';
  }

  if (statusCode === null) {
    return name === 'application_error' || name === 'internal_server_error'
      ? 'unavailable'
      : 'rejected';
  }

  if (statusCode === 429) {
    return 'throttled';
  }

  return statusCode >= 400 && statusCode < 500 ? 'rejected' : 'unavailable';
}

/**
 * Build the failure result *and* log it.
 *
 * Logging here rather than at the call sites is deliberate: there are ten send
 * helpers and many more callers, and the one thing that must not depend on all
 * of them remembering is the record an operator needs to re-send by hand. The
 * line carries the recipient and the subject — enough to identify the message —
 * plus the reason and the cause.
 *
 * `not_configured` logs at warn rather than error because it is the normal state
 * of a developer's machine, and a log level that cries wolf on every local test
 * run stops being read in production.
 */
function fail(
  message: EmailMessage,
  reason: SendFailureReason,
  detail: string,
): SendResult {
  const line = {
    to: message.to,
    subject: message.subject,
    reason,
    detail,
  };

  if (reason === 'not_configured') {
    console.warn('[email] not sent', line);
  } else {
    console.error('[email] send failed', line);
  }

  return { sent: false, reason, detail };
}

/** A thrown value as a log-worthy string, whether or not it is an `Error`. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
}
