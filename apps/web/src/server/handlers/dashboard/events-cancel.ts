import type { AuthContext, OrgContext } from '@upskills/auth';
import type {
  AddressedSendResult,
  SendFailureReason,
  SendResult,
} from '@upskills/email';
import type { CancelEventResult } from '@upskills/firestore';
import type { Guest, OrgRole, WorkshopEvent } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden } from './dashboard-access';

/**
 * `DELETE /api/v1/dashboard/events/:eventId` — cancel an event and tell
 * everyone holding a seat.
 *
 * Delete is a cancel, never a hard delete. `cancelEvent` sets
 * `status: 'cancelled'` and leaves the event document and every guest document
 * in place; removing either would orphan paid guests and destroy the payment
 * audit trail.
 *
 * Like the detail and update routes, the org is read off the event document
 * before `requireOrgRole` can run; a missing event is therefore the same 403
 * as an unauthorized one. `requireAuth` runs before that read for the same
 * reason as in `events-detail.ts`: without it, an unauthenticated caller gets
 * 403 for a missing event and 401 for one that exists, which is the very
 * existence oracle the shared 403 exists to close.
 *
 * The cancellation commits before any email is attempted, and every send
 * helper in `@upskills/email` returns a {@link SendResult} rather than
 * throwing. A Resend outage therefore cancels the event and reports the failed
 * fan-out in the body; it never rolls the cancellation back or turns it into a
 * 500.
 */

/** How many cancellation emails are in flight at once. */
export const EMAIL_BATCH_SIZE = 10;

/** Why one guest did not receive the cancellation email. */
export interface DashboardEventsCancelEmailFailure {
  email: string;
  reason: SendFailureReason;
  detail: string;
}

/** What the cancellation email fan-out did, per the response contract. */
export interface DashboardEventsCancelNotification {
  /** Number of confirmed guests the fan-out attempted to email. */
  attempted: number;
  /** Number of those Resend accepted for delivery. */
  sent: number;
  /** Number not accepted; each one is listed in `failures`. */
  failed: number;
  failures: DashboardEventsCancelEmailFailure[];
}

export interface DashboardEventsCancelResponse {
  /** The event as persisted by `cancelEvent`, with `status: 'cancelled'`. */
  event: WorkshopEvent;
  notification: DashboardEventsCancelNotification;
}

export interface DashboardEventsCancelDeps {
  /** `requireAuth` from `@upskills/auth`. Runs before the event is read. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(eventId: string): Promise<WorkshopEvent | null>;
  /** `cancelEvent` from `@upskills/firestore`. */
  cancelEvent(eventId: string): Promise<CancelEventResult>;
  /** `sendCancellationEmail` from `@upskills/email`. Never throws. */
  sendCancellationEmail(
    guest: Guest,
    event: WorkshopEvent,
  ): Promise<SendResult>;
}

export function createDashboardEventsCancelHandler(
  deps: DashboardEventsCancelDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      // Before the read, so an unauthenticated caller cannot tell a missing
      // event from one that exists. See `events-detail.ts`.
      await deps.requireAuth(event);

      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      const found = await deps.getEvent(eventId);

      if (found === null) {
        throw eventForbidden();
      }

      await deps.requireOrgRole(event, found.orgId, 'admin', 'manager');

      const cancelled = await deps.cancelEvent(eventId);

      return {
        event: cancelled.event,
        notification: await notifyConfirmedGuests(
          cancelled.confirmedGuests,
          cancelled.event,
          deps,
        ),
      } satisfies DashboardEventsCancelResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * Email every confirmed guest, in bounded batches.
 *
 * `cancelEvent` returns every confirmed guest with no cap — `maxGuests: 0`
 * means unlimited — so a large free event can hand back a long list. The list
 * itself is never capped: under-notifying is worse than the memory cost. But
 * one `Promise.all` over the whole array would open that many concurrent
 * connections to Resend at once, so sends are fanned out in batches of
 * {@link EMAIL_BATCH_SIZE}.
 */
async function notifyConfirmedGuests(
  guests: readonly Guest[],
  event: WorkshopEvent,
  deps: DashboardEventsCancelDeps,
): Promise<DashboardEventsCancelNotification> {
  const confirmed = guests.filter((guest) => guest.status === 'confirmed');
  const results: AddressedSendResult[] = [];

  for (let index = 0; index < confirmed.length; index += EMAIL_BATCH_SIZE) {
    const batch = confirmed.slice(index, index + EMAIL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (guest) => {
        const result = await deps.sendCancellationEmail(guest, event);
        return { ...result, to: guest.email };
      }),
    );
    results.push(...batchResults);
  }

  const failures = results.flatMap((result) =>
    result.sent
      ? []
      : [{ email: result.to, reason: result.reason, detail: result.detail }],
  );

  return {
    attempted: confirmed.length,
    sent: results.length - failures.length,
    failed: failures.length,
    failures,
  };
}
