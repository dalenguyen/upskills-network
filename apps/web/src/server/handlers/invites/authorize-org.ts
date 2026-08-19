import type { AuthContext, OrgContext } from '@upskills/auth';
import type { OrgRole, Organizer } from '@upskills/models';
import type { H3Event } from 'h3';
import { notFound } from '../http-error';

/**
 * The two ways a caller earns the right to manage one org's invitations.
 *
 * `org-invites.ts` holds the behavior and takes this as a dependency, so the
 * platform-admin console and the organizer's own dashboard share every rule
 * about invitations and differ only here, in who is allowed to ask.
 */

export interface AuthorizedOrg {
  /** The caller, recorded as the inviter or the confirming admin. */
  uid: string;
  org: Organizer;
}

/**
 * Platform admin: any org, by id.
 *
 * A missing org is a 404 rather than the 403 the dashboard answers, because a
 * platform admin is allowed to know which orgs exist — telling them apart is
 * only a leak when the caller could not see the org either way.
 */
export function adminAuthorizeOrg(deps: {
  requireAdmin(event: H3Event): Promise<AuthContext>;
  getOrg(orgId: string): Promise<Organizer | null>;
}) {
  return async (event: H3Event, orgId: string): Promise<AuthorizedOrg> => {
    const { uid } = await deps.requireAdmin(event);
    const org = await deps.getOrg(orgId);

    if (org === null) {
      throw notFound('org-not-found', 'No such organizer.');
    }

    return { uid, org };
  };
}

/**
 * The org's own admins.
 *
 * `requireOrgRole` already carries the organizer on {@link OrgContext.org}, so
 * this never re-reads it — and a missing org, a non-member, and a member with
 * the wrong role all come back as the same 403, which is what stops org ids
 * being probed from the dashboard.
 */
export function dashboardAuthorizeOrg(deps: {
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
}) {
  return async (event: H3Event, orgId: string): Promise<AuthorizedOrg> => {
    const context = await deps.requireOrgRole(event, orgId, 'admin');

    return { uid: context.uid, org: context.org };
  };
}
