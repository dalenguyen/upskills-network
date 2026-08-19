import type { SendResult } from '@upskills/email';
import type { TransitionResult } from '@upskills/firestore';
import type { Guest, WorkshopEvent } from '@upskills/models';
import { CancelGuestSchema } from '@upskills/validation';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, notFound, toHttpError } from '../http-error';
import { forbidden } from './registration-errors';

/**
 * `POST /api/v1/registration/:orgId/:eventId/cancel` — self-service
 * cancellation.
 *
 * The organizer segment addresses the event's subcollection path; see
 * `register.ts` for why it is a path component and not a permission check.
 *
 * ## The token is the entire authorization
 *
 * There is no session here: a guest has no account, so the only thing
 * distinguishing the registrant from a stranger is the `cancelToken` that went
 * out in their confirmation email. An earlier draft of this design keyed
 * cancellation on the email address alone, which would let anyone who can type
 * a colleague's address cancel their spot — and the victim would find out at
 * the door.
 *
 * ## Every failure answers the same 403
 *
 * A wrong token, a token for a registration that does not exist, and an email
 * that never registered all produce one identical response. Any difference
 * between them turns this endpoint into a membership oracle: submit an address
 * with a junk token and learn from the status code whether that person is
 * attending. That is exactly the enumeration the lookup route refuses to allow,
 * and it would be pointless to close it there and leave it open here.
 *
 * The comparison is constant-time and runs even when there is no registration
 * at all — see {@link tokenMatches} — so the timing does not answer the
 * question the status code refuses to.
 *
 * ## Promotion is attempted on every accepted cancellation
 *
 * Including one that changed nothing because the guest had already cancelled.
 * `promoteNextPending` re-checks capacity and the waitlist inside its own
 * transaction, so a call with nothing to do is a cheap no-op — and a second
 * click of a cancel link is then the thing that repairs a promotion lost to a
 * crash after the first. Gating it on "did we just free a seat" would make that
 * state permanent.
 *
 * A waitlisted guest cancelling frees no seat, and the capacity check inside
 * `promoteNextPending` is what notices: the event is still full, so nobody is
 * promoted. This route does not need to know the difference.
 */

export interface CancelResponse {
  /** Always `true` on a 2xx — the registration is not standing any more. */
  cancelled: boolean;
  /** `true` when the registration had already been cancelled before this call. */
  alreadyCancelled: boolean;
  /** `true` when a waitlisted guest was moved into the freed seat. */
  promoted: boolean;
  /** Whether the cancellation confirmation was accepted for delivery. */
  emailSent: boolean;
}

export interface CancelDeps {
  /** `getGuest` from `@upskills/firestore`. */
  getGuest(
    orgId: string,
    eventId: string,
    email: string,
  ): Promise<Guest | null>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(orgId: string, eventId: string): Promise<WorkshopEvent | null>;
  /** `cancelGuest` from `@upskills/firestore`. */
  cancelGuest(
    orgId: string,
    eventId: string,
    email: string,
  ): Promise<TransitionResult>;
  /** `promoteNextPending` from `@upskills/firestore`. */
  promoteNextPending(orgId: string, eventId: string): Promise<Guest | null>;
  /** `sendCancellationEmail` from `@upskills/email`. Never throws. */
  sendCancellationEmail(
    guest: Guest,
    event: WorkshopEvent,
  ): Promise<SendResult>;
  /** `sendSpotOpenedEmail` from `@upskills/email`. Never throws. */
  sendSpotOpenedEmail(guest: Guest, event: WorkshopEvent): Promise<SendResult>;
}

/**
 * A token of the right shape that matches nothing.
 *
 * Compared against when there is no registration, so the work done — and the
 * time it takes — is the same as for a real one that simply does not match.
 */
const DECOY_TOKEN = 'x'.repeat(32);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time token check that does the same work whether or not a
 * registration exists.
 *
 * Digests are compared rather than the raw strings: SHA-256 output is always 32
 * bytes, so `timingSafeEqual` never sees the length mismatch it throws on, and
 * the length of the stored token is not leaked by the comparison either.
 *
 * The `stored !== undefined` test is deliberately *after* the comparison. Put
 * first it would short-circuit, and a missing registration would return in
 * measurably less time than a wrong token — reintroducing by the clock the
 * distinction the response is careful not to make.
 */
function tokenMatches(supplied: string, stored: string | undefined): boolean {
  const matches = timingSafeEqual(
    digest(supplied),
    digest(stored ?? DECOY_TOKEN),
  );

  return matches && stored !== undefined;
}

/** The one 403 this route produces, for every reason it produces one. */
function refuse() {
  return forbidden(
    'cancel-refused',
    'That cancellation link is not valid. Check the link in your confirmation email.',
  );
}

export function createCancelHandler(deps: CancelDeps): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    try {
      const orgId = getRouterParam(event, 'orgId');
      const eventId = getRouterParam(event, 'eventId');

      if (!orgId || !eventId) {
        throw refuse();
      }

      const parsed = CancelGuestSchema.safeParse(await readBody(event));

      if (!parsed.success) {
        throw badRequest(
          'invalid-cancellation',
          'Enter a valid email address and cancellation token.',
        );
      }

      const { email, cancelToken } = parsed.data;
      const guest = await deps.getGuest(orgId, eventId, email);

      if (!tokenMatches(cancelToken, guest?.cancelToken)) {
        throw refuse();
      }

      const workshop = await deps.getEvent(orgId, eventId);

      if (workshop === null) {
        // The guest document exists but its event does not. Nothing to cancel
        // against and nothing to email about; this is a broken data state, not
        // a caller error, so it does not get the 403 treatment.
        throw notFound('event-not-found', 'No such event.');
      }

      const result = await deps.cancelGuest(orgId, eventId, email);
      const promoted = await deps.promoteNextPending(orgId, eventId);

      return {
        cancelled: true,
        alreadyCancelled: !result.changed,
        promoted: promoted !== null,
        emailSent: await notify(result, promoted, workshop, deps),
      } satisfies CancelResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * Tell the leaver it is done, and the promoted guest that a spot opened.
 *
 * Only the leaver's send decides `emailSent`: it is the one the caller is
 * waiting on and the one they can act on. A failed "spot opened" is a worse
 * problem — someone now holds a seat they have not been told about — but the
 * person who can do anything about it is the organizer, not the guest cancelling.
 * That belongs in a log and an operational alert, not in this response.
 *
 * A repeat cancellation sends nothing: the confirmation went out the first time,
 * and a second copy reads as though something new happened.
 */
async function notify(
  result: TransitionResult,
  promoted: Guest | null,
  workshop: WorkshopEvent,
  deps: CancelDeps,
): Promise<boolean> {
  if (promoted !== null) {
    await deps.sendSpotOpenedEmail(promoted, workshop);
  }

  if (!result.changed || result.guest === null) {
    return true;
  }

  return (await deps.sendCancellationEmail(result.guest, workshop)).sent;
}
