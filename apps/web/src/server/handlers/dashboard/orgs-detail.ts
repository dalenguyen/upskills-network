import type { OrgContext } from '@upskills/auth';
import type { OrgInvite, OrgInviteStatus, OrgRole } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { toOrgInviteView, type OrgInviteView } from '../invites/invite-view';
import { toDashboardOrg, type DashboardOrg } from './org-view';

/**
 * `GET /api/v1/dashboard/orgs/:orgId` — the caller's own organizer.
 *
 * Unlike the admin org detail this never reads the org itself: `requireOrgRole`
 * returns the organizer document on {@link OrgContext.org} only after the
 * caller has passed authorization. A missing org, a non-member, and a member
 * with the wrong role are all the same 403 from the guard, so probing org ids
 * cannot learn which ones exist. Any member role may read the org; the roster
 * is only ever answered to someone already in it.
 */

export interface DashboardOrgsDetailResponse {
  org: DashboardOrg;
  /** Outstanding invitations, shown on the roster beside the members. */
  invites: OrgInviteView[];
}

export interface DashboardOrgsDetailDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
  /** `listOrgInvites` from `@upskills/firestore`. */
  listOrgInvites(orgId: string): Promise<OrgInvite[]>;
  /** `orgInviteStatus` from `@upskills/firestore`. */
  orgInviteStatus(invite: OrgInvite, now?: Date): OrgInviteStatus;
}

export function createDashboardOrgsDetailHandler(
  deps: DashboardOrgsDetailDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = getRouterParam(event, 'orgId');

      if (orgId === undefined || orgId === '') {
        throw badRequest(
          'invalid-org-id',
          'Expected a non-empty orgId route parameter.',
        );
      }

      const context = await deps.requireOrgRole(
        event,
        orgId,
        'admin',
        'manager',
        'check_in',
        'volunteer',
      );

      const [emails, invites] = await Promise.all([
        deps.getUserEmails(Object.keys(context.org.members)),
        deps.listOrgInvites(orgId),
      ]);

      return {
        org: toDashboardOrg(context.org, emails),
        invites: invites.map((invite) =>
          toOrgInviteView(invite, deps.orgInviteStatus(invite)),
        ),
      } satisfies DashboardOrgsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
