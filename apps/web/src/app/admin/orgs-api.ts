import type { OrgRole } from '@upskills/models';

import type {
  AdminOrg,
  AdminOrgMembership,
} from '../../server/handlers/admin/admin-view';
import type { OrgMembersRemoveResponse } from '../../server/handlers/admin/org-members-remove';
import type { OrgMembersSetResponse } from '../../server/handlers/admin/org-members-set';
import type { OrgsCreateResponse } from '../../server/handlers/admin/orgs-create';
import type { OrgsDetailResponse } from '../../server/handlers/admin/orgs-detail';
import type { OrgsListResponse } from '../../server/handlers/admin/orgs-list';
import type { OrgInviteView } from '../../server/handlers/invites/invite-view';
import type { OrgInvitesResponse } from '../../server/handlers/invites/org-invites';

/**
 * The platform-admin org API, as the browser sees it.
 *
 * ## Why the types come from the server handlers
 *
 * Every import from `src/server` here is `import type`, so nothing from the
 * server survives into the browser bundle — the declarations are erased at
 * compile time and the runtime graph is unchanged. What they buy is that the
 * admin pages and the routes they call cannot drift apart silently: renaming a
 * field in `AdminOrg`, `OrgsListResponse`, `OrgsCreateResponse`,
 * `OrgsDetailResponse`, `OrgMembersSetResponse`, or `OrgMembersRemoveResponse`
 * breaks the type-check here instead of producing an `undefined` on a rendered
 * page.
 */

export type { AdminOrg, AdminOrgMembership };
export type { OrgRole };
export type { OrgMembersRemoveResponse };
export type { OrgMembersSetResponse };
export type { OrgsCreateResponse };
export type { OrgsDetailResponse };
export type { OrgsListResponse };
export type { OrgInviteView };

/** What every admin invite write answers: the roster and its invitations. */
export type AdminOrgInvitesResponse = OrgInvitesResponse<AdminOrg>;

/** `GET` — every organizer, oldest first. */
export function adminOrgsEndpoint(): string {
  return '/api/v1/admin/orgs';
}

/** `POST` — create an organizer and reserve its slug. */
export function adminOrgCreateEndpoint(): string {
  return '/api/v1/admin/orgs';
}

/** `GET` — one organizer by id, members included. */
export function adminOrgDetailEndpoint(orgId: string): string {
  return `/api/v1/admin/orgs/${encodeURIComponent(orgId)}`;
}

/**
 * `POST` / `PUT` / `DELETE` — add, change, or remove one member of an org.
 *
 * The three verbs share one path by design: `POST` adds a member, `PUT` changes
 * an existing member's role, and `DELETE` removes the member named by the body.
 */
export function adminOrgMembersEndpoint(orgId: string): string {
  return `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/members`;
}

/**
 * `POST` — invite an email address to an org, or resend an outstanding
 * invitation. `DELETE` — withdraw one, named by `inviteId` in the body.
 */
export function adminOrgInvitesEndpoint(orgId: string): string {
  return `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/invites`;
}

/** `POST` — accept an invitation on the invitee's behalf. */
export function adminOrgInviteConfirmEndpoint(orgId: string): string {
  return `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/invites/confirm`;
}
