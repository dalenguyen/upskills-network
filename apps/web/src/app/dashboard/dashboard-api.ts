import type { MeGetResponse, MeOrg, MeUser } from '../../server/handlers/auth/me-get';
import type { DashboardEventsListResponse } from '../../server/handlers/dashboard/events-list';
import type { WorkshopEvent } from '@upskills/models';

/**
 * The organizer dashboard API, as the browser sees it.
 *
 * ## Why the types come from the server handlers
 *
 * Every import from `src/server` here is `import type`, so nothing from the
 * server survives into the browser bundle — the declarations are erased at
 * compile time and the runtime graph is unchanged. What they buy is that the
 * dashboard pages and the routes they call cannot drift apart silently:
 * renaming a field in `MeGetResponse` or `DashboardEventsListResponse` breaks
 * the type-check here instead of producing an `undefined` on a rendered page.
 */

export type { MeGetResponse, MeOrg, MeUser };
export type { DashboardEventsListResponse };
export type { WorkshopEvent };

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
