import type { SendResult } from '@upskills/email';
import type { OrgContext } from '@upskills/auth';
import type { CancelEventResult } from '@upskills/firestore';
import type { OrgRole, WorkshopEvent } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { readEventForOrg } from './event-access';
import { toDashboardEvent, type DashboardEvent } from './event-view';

/**
 * `DELETE /api/v1/dashboard/events/:eventId` — cancel an event and notify its
 * confirmed guests.
 *
 * There is no hard delete. `cancelEvent` sets `status: 'cancelled'` and keeps
 * the document; deleting it would orphan paid guest documents and destroy the
 * payment audit trail.
 *
 * ## A failed email does not fail the cancellation
 *
 * The cancellation commits before any mail is attempted, and every send helper
 * in `@upskills/email` never throws. A Resend outage therefore produces a
 * cancelled event with some guests not yet told, and the response body says
 * exactly which sends failed so the caller can surface it — rather than
 * swallowing the failure or rolling back a committed cancellation.
 */

export interface CancellationNotice {
  email: string;
  sent: boolean;
  reason?: string;
  detail?: string;
}

export interface EventCancelResponse {
  event: DashboardEvent;
  /** How many confirmed guests were accepted for delivery. */
  notified: number;
  /** How many confirmed guests could not be emailed. */
  failed: number;
  /** One entry per confirmed guest, so a partial outage is visible. */
  notifications: CancellationNotice[];
}

export interface EventCancelDeps {
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
    guest: CancelEventResult['guests'][number],
    event: WorkshopEvent,
  ): Promise<SendResult>;
}

export function createEventsCancelHandler(
  deps: EventCancelDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const found = await readEventForOrg(event, deps.getEvent);

      await deps.requireOrgRole(event, found.orgId, 'admin', 'manager');

      const cancelled = await deps.cancelEvent(found.eventId);
      const notifications = await notifyGuests(cancelled, deps);
      const notified = notifications.filter((notice) => notice.sent).length;

      return {
        event: toDashboardEvent(cancelled.event),
        notified,
        failed: notifications.length - notified,
        notifications,
      } satisfies EventCancelResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * Email every confirmed guest and collect the result of each send.
 *
 * `Promise.all` rather than a sequential loop: guests are independent, and the
 * whole point of the shape is that one failed send cannot delay or abort the
 * rest.
 */
async function notifyGuests(
  cancelled: CancelEventResult,
  deps: EventCancelDeps,
): Promise<CancellationNotice[]> {
  return Promise.all(
    cancelled.guests.map(async (guest) => {
      const result = await deps.sendCancellationEmail(guest, cancelled.event);

      return {
        email: guest.email,
        sent: result.sent,
        ...(result.sent ? {} : { reason: result.reason, detail: result.detail }),
      } satisfies CancellationNotice;
    }),
  );
}
