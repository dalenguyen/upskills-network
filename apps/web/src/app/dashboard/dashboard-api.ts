import type {
  MeGetResponse,
  MeOrg,
  MeUser,
} from '../../server/handlers/auth/me-get';
import type { DashboardEventsCancelResponse } from '../../server/handlers/dashboard/events-cancel';
import type { DashboardEventsCreateResponse } from '../../server/handlers/dashboard/events-create';
import type { DashboardEventsDetailResponse } from '../../server/handlers/dashboard/events-detail';
import type {
  DashboardEventsGuestsResponse,
  GuestView,
} from '../../server/handlers/dashboard/events-guests';
import type {
  DashboardEvent,
  DashboardEventsListResponse,
} from '../../server/handlers/dashboard/events-list';
import type { DashboardEventsUpdateResponse } from '../../server/handlers/dashboard/events-update';
import type { DashboardOrgMembersRemoveResponse } from '../../server/handlers/dashboard/org-members-remove';
import type { DashboardOrgMembersSetResponse } from '../../server/handlers/dashboard/org-members-set';
import type { DashboardOrgsCreateResponse } from '../../server/handlers/dashboard/orgs-create';
import type { DashboardOrgsDetailResponse } from '../../server/handlers/dashboard/orgs-detail';
import type {
  DashboardOrg,
  DashboardOrgMembership,
} from '../../server/handlers/dashboard/org-view';
import type { OrgInviteView } from '../../server/handlers/invites/invite-view';
import type { OrgInvitesResponse } from '../../server/handlers/invites/org-invites';

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
 * `DashboardEventsCancelResponse`, `DashboardEventsUpdateResponse`,
 * `DashboardOrgsCreateResponse`, `DashboardOrgsDetailResponse`,
 * `DashboardOrgMembersSetResponse`, or `DashboardOrgMembersRemoveResponse`
 * breaks the type-check here instead of producing an `undefined` on a rendered
 * page.
 */

export type { MeGetResponse, MeOrg, MeUser };
export type { DashboardEventsCancelResponse };
export type { DashboardEventsCreateResponse };
export type { DashboardEventsDetailResponse };
export type { DashboardEventsGuestsResponse, GuestView };
export type { DashboardEventsListResponse };
export type { DashboardEventsUpdateResponse };
export type { DashboardEvent };
export type { DashboardOrgsCreateResponse };
export type { DashboardOrgsDetailResponse };
export type { DashboardOrgMembersSetResponse };
export type { DashboardOrgMembersRemoveResponse };
export type { DashboardOrg, DashboardOrgMembership };
export type { OrgInviteView };

/** What every dashboard invite write answers: the roster and its invitations. */
export type DashboardOrgInvitesResponse = OrgInvitesResponse<DashboardOrg>;

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
export function dashboardEventDetailEndpoint(
  orgId: string,
  eventId: string,
): string {
  return `${dashboardEventPath(eventId)}?orgId=${encodeURIComponent(orgId)}`;
}

/** `GET` — the guest list for one event owned by one org. No email on the wire. */
export function dashboardEventGuestsEndpoint(
  orgId: string,
  eventId: string,
): string {
  return `${dashboardEventPath(eventId)}/guests?orgId=${encodeURIComponent(orgId)}`;
}

/** `PUT` — update one event owned by one org. */
export function dashboardEventUpdateEndpoint(
  orgId: string,
  eventId: string,
): string {
  return `${dashboardEventPath(eventId)}?orgId=${encodeURIComponent(orgId)}`;
}

/** `DELETE` — cancel one event owned by one org and notify confirmed guests. */
export function dashboardEventCancelEndpoint(
  orgId: string,
  eventId: string,
): string {
  return `${dashboardEventPath(eventId)}?orgId=${encodeURIComponent(orgId)}`;
}

/**
 * `DELETE` — permanently remove a **draft** event with no registrations,
 * freeing its slug.
 *
 * A different URL from {@link dashboardEventCancelEndpoint} on purpose: a plain
 * `DELETE` on the event cancels it and emails the guests, and the destructive
 * one has to be asked for by name. The server refuses anything that is not a
 * guest-free draft with 409 `event-not-deletable`.
 */
export function dashboardEventDeleteEndpoint(
  orgId: string,
  eventId: string,
): string {
  return `${dashboardEventPath(eventId)}/permanent?orgId=${encodeURIComponent(orgId)}`;
}

/**
 * `DELETE` — remove an organizer that owns no events, freeing its slug.
 *
 * Refused with 409 `org-not-empty` while any event still exists under it.
 */
export function dashboardOrgDeleteEndpoint(orgId: string): string {
  return `/api/v1/dashboard/orgs/${encodeURIComponent(orgId)}`;
}

/**
 * The shared prefix of the three per-event dashboard routes.
 *
 * Each of them additionally carries `?orgId=`: events are stored at
 * `organizers/{orgId}/events/{eventId}`, so the event id alone does not address
 * a document. The org also arrives early enough for the server to authorize the
 * caller before it reads anything.
 */
function dashboardEventPath(eventId: string): string {
  return `/api/v1/dashboard/events/${encodeURIComponent(eventId)}`;
}

/** `POST` — create the caller's own organizer. */
export function dashboardOrgCreateEndpoint(): string {
  return '/api/v1/dashboard/orgs';
}

/** `GET` — the caller's own organizer, staff roster included. */
export function dashboardOrgDetailEndpoint(orgId: string): string {
  return `/api/v1/dashboard/orgs/${encodeURIComponent(orgId)}`;
}

/**
 * `POST` / `PUT` / `DELETE` — add, change, or remove one member of an org.
 *
 * Same `orgId` encoding as `dashboardEventsEndpoint`: the path segment must not
 * be able to smuggle `/` into the request.
 */
export function dashboardOrgMembersEndpoint(orgId: string): string {
  return `/api/v1/dashboard/orgs/${encodeURIComponent(orgId)}/members`;
}

/**
 * `POST` — invite an email address to the org, or resend an outstanding
 * invitation. `DELETE` — withdraw one, named by `inviteId` in the body.
 */
export function dashboardOrgInvitesEndpoint(orgId: string): string {
  return `/api/v1/dashboard/orgs/${encodeURIComponent(orgId)}/invites`;
}

/** `POST` — accept an invitation on the invitee's behalf. */
export function dashboardOrgInviteConfirmEndpoint(orgId: string): string {
  return `/api/v1/dashboard/orgs/${encodeURIComponent(orgId)}/invites/confirm`;
}
