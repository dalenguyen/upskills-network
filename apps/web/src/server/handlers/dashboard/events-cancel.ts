import type { AuthContext, OrgContext } from '@upskills/auth';
import type {
  AddressedSendResult,
  SendFailureReason,
  SendResult,
} from '@upskills/email';
import type { CancelEventResult } from '@upskills/firestore';
import type {
  Guest,
  OrgRole,
  Organizer,
  WorkshopEvent,
} from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { toHttpError } from '../http-error';
import { eventForbidden, readOrgId } from './dashboard-access';
import { toDashboardEvent, type DashboardEvent } from './events-list';

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
  event: DashboardEvent;
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
  getEvent(orgId: string, eventId: string): Promise<WorkshopEvent | null>;
  /** `getOrg` from `@upskills/firestore`. Resolves the org slug the cancellation email links to. */
  getOrg(orgId: string): Promise<Organizer | null>;
  /** `cancelEvent` from `@upskills/firestore`. */
  cancelEvent(orgId: string, eventId: string): Promise<CancelEventResult>;
  /** `sendCancellationEmail` from `@upskills/email`. Never throws. */
  sendCancellationEmail(
    guest: Guest,
    event: WorkshopEvent,
    orgSlug: string,
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

      const orgId = readOrgId(event);
      const eventId = getRouterParam(event, 'eventId');

      if (eventId === undefined || eventId === '') {
        throw eventForbidden();
      }

      // Authorize before reading — see `events-detail.ts` for why the org now
      // comes from `?orgId=` rather than from the event document.
      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      const found = await deps.getEvent(orgId, eventId);

      if (found === null) {
        throw eventForbidden();
      }

      // Already cancelled: answer with the event and notify nobody.
      //
      // `cancelEvent` is idempotent on the document, but the emails are not.
      // Guest documents keep their `confirmed` status when an event is
      // cancelled, so a second call — a retry, a double-click, or a second
      // organizer — would hand back the same guest list and mail every one of
      // them a duplicate cancellation. There is no useful work left to do here,
      // and the honest answer is the one that does none of it.
      if (found.status === 'cancelled') {
        return {
          event: toDashboardEvent(found),
          notification: { attempted: 0, sent: 0, failed: 0, failures: [] },
        } satisfies DashboardEventsCancelResponse;
      }

      const org = await deps.getOrg(orgId);

      if (org === null) {
        throw eventForbidden();
      }

      const cancelled = await deps.cancelEvent(orgId, eventId);

      return {
        event: toDashboardEvent(cancelled.event),
        notification: await notifyConfirmedGuests(
          cancelled.confirmedGuests,
          cancelled.event,
          org.slug,
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
  orgSlug: string,
  deps: DashboardEventsCancelDeps,
): Promise<DashboardEventsCancelNotification> {
  const confirmed = guests.filter((guest) => guest.status === 'confirmed');
  const results: AddressedSendResult[] = [];

  for (let index = 0; index < confirmed.length; index += EMAIL_BATCH_SIZE) {
    const batch = confirmed.slice(index, index + EMAIL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (guest) => {
        const result = await deps.sendCancellationEmail(guest, event, orgSlug);
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
