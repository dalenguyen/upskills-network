import type {
  MeGetResponse,
  MeOrg,
  MeUser,
} from '../../server/handlers/auth/me-get';
import type { DashboardEventsCancelResponse } from '../../server/handlers/dashboard/events-cancel';
import type { DashboardEventsCreateResponse } from '../../server/handlers/dashboard/events-create';
import type { DashboardEventsDetailResponse } from '../../server/handlers/dashboard/events-detail';
import type {
  DashboardEvent,
  DashboardEventsListResponse,
} from '../../server/handlers/dashboard/events-list';
import type { DashboardEventsUpdateResponse } from '../../server/handlers/dashboard/events-update';

/**
 * The organizer dashboard API, as the browser sees it.
 *
 * ## Why the types come from the server handlers
 *
 * Every import from `src/server` here is `import type`, so nothing from the
 * server survives into the browser bundle — the declarations are erased at
 * compile time and the runtime graph is unchanged. What they buy is that the
 * dashboard pages and the routes they call cannot drift apart silently:
 * renaming a field in `MeGetResponse`, `DashboardEventsListResponse`,
 * `DashboardEventsCreateResponse`, `DashboardEventsDetailResponse`,
 * `DashboardEventsCancelResponse`, or `DashboardEventsUpdateResponse` breaks
 * the type-check here instead of producing an `undefined` on a rendered page.
 */

export type { MeGetResponse, MeOrg, MeUser };
export type { DashboardEventsCancelResponse };
export type { DashboardEventsCreateResponse };
export type { DashboardEventsDetailResponse };
export type { DashboardEventsListResponse };
export type { DashboardEventsUpdateResponse };
export type { DashboardEvent };

/** `GET` — the signed-in user and the organizers they belong to. */
export function meEndpoint(): string {
  return '/api/v1/auth/me';
}

/**
 * `GET` — every event owned by one org, all statuses, newest first.
 *
 * `orgId` is encoded the same way the public event slug is in `event-api.ts`:
 * a query value can otherwise smuggle a `&` or `=` into the URL.
 */
export function dashboardEventsEndpoint(orgId: string): string {
  return `/api/v1/dashboard/events?orgId=${encodeURIComponent(orgId)}`;
}

/**
 * `POST` — create an event for one org.
 *
 * Same `orgId` encoding as `dashboardEventsEndpoint`: the query value is the
 * org the event is created under, and it must not be able to smuggle URL
 * delimiters into the request.
 */
export function dashboardEventCreateEndpoint(orgId: string): string {
  return `/api/v1/dashboard/events?orgId=${encodeURIComponent(orgId)}`;
}

/** `GET` — one event owned by one org. */
export function dashboardEventDetailEndpoint(eventId: string): string {
  return `/api/v1/dashboard/events/${encodeURIComponent(eventId)}`;
}

/** `PUT` — update one event owned by one org. */
export function dashboardEventUpdateEndpoint(eventId: string): string {
  return `/api/v1/dashboard/events/${encodeURIComponent(eventId)}`;
}

/** `DELETE` — cancel one event owned by one org and notify confirmed guests. */
export function dashboardEventCancelEndpoint(eventId: string): string {
  return `/api/v1/dashboard/events/${encodeURIComponent(eventId)}`;
}
