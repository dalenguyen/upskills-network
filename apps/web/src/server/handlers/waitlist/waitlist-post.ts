import type { SendResult } from '@upskills/email';
import type { WaitlistOutcome } from '@upskills/firestore';
import { EmailSchema } from '@upskills/validation';
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type EventHandler,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';

/**
 * `POST /api/v1/waitlist` — add an email address to the landing-page waitlist,
 * once.
 *
 * ## Why the write happens before the email
 *
 * `addWaitlistSubscriber` commits the signup first, and only a *new* signup
 * gets a confirmation email. A duplicate returns `already_subscribed` and sends
 * nothing, because the original confirmation is already in the subscriber's
 * inbox and a second one would read as a bug.
 *
 * The email is sent after the commit, and `sendWaitlistConfirmationEmail` never
 * throws — the same rule every send helper in `@upskills/email` enforces. A
 * Resend outage must not turn a committed signup into a 500 that invites the
 * visitor to submit again.
 */

/** What a successful signup tells the client. */
export interface WaitlistPostResponse {
  status: WaitlistOutcome;
}

export interface WaitlistPostDeps {
  /** `addWaitlistSubscriber` from `@upskills/firestore`. */
  addWaitlistSubscriber(email: string): Promise<WaitlistOutcome>;
  /** `sendWaitlistConfirmationEmail` from `@upskills/email`. Never throws. */
  sendWaitlistConfirmationEmail(email: string): Promise<SendResult>;
}

export function createWaitlistPostHandler(
  deps: WaitlistPostDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    const email = readEmail(await readBody<unknown>(event));

    try {
      const outcome = await deps.addWaitlistSubscriber(email);

      if (outcome !== 'subscribed') {
        return { status: outcome } satisfies WaitlistPostResponse;
      }

      const result = await deps.sendWaitlistConfirmationEmail(email);

      if (!result.sent) {
        // The email lib already logs the recipient, subject, and cause; this
        // line records the failure on the waitlist path as well, without
        // letting it fail the signup that is already committed.
        console.error('[waitlist] confirmation email not sent', result);
      }

      setResponseStatus(event, 201);
      return { status: outcome } satisfies WaitlistPostResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * The email out of the request body, or a 400.
 *
 * A body with no `email` at all is a malformed *request*, while an `email`
 * that fails {@link EmailSchema} is a rejected value. Both are 400s, but the
 * error code distinguishes "the client sent the wrong shape" from "the client
 * sent a shape we could see and refused".
 */
function readEmail(body: unknown): string {
  const email = (body as { email?: unknown } | null | undefined)?.email;

  if (typeof email !== 'string') {
    throw badRequest(
      'invalid-body',
      'Expected a JSON body of the form { "email": "…" }.',
    );
  }

  const parsed = EmailSchema.safeParse(email);

  if (!parsed.success) {
    throw badRequest('invalid-email', 'Enter a valid email address.');
  }

  return parsed.data;
}
