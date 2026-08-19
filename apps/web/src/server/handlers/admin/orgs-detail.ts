import type { AuthContext } from '@upskills/auth';
import type { OrgInvite, OrgInviteStatus, Organizer } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';
import { toOrgInviteView, type OrgInviteView } from '../invites/invite-view';
import { toAdminOrg, type AdminOrg } from './admin-view';

/**
 * `GET /api/v1/admin/orgs/:orgId` — one organizer by id.
 *
 * Platform-admin only. Unlike the public org page this answers by `orgId`, the
 * id the admin console keys on, and it ships the whole document (members
 * included) to a caller already allowed to see it.
 */

export interface OrgsDetailResponse {
  org: AdminOrg;
  /** Outstanding invitations, shown on the roster beside the members. */
  invites: OrgInviteView[];
}

export interface OrgsDetailDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `getOrg` from `@upskills/firestore`. */
  getOrg(orgId: string): Promise<Organizer | null>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
  /** `listOrgInvites` from `@upskills/firestore`. */
  listOrgInvites(orgId: string): Promise<OrgInvite[]>;
  /** `orgInviteStatus` from `@upskills/firestore`. */
  orgInviteStatus(invite: OrgInvite, now?: Date): OrgInviteStatus;
}

export function createOrgsDetailHandler(deps: OrgsDetailDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      await deps.requireAdmin(event);

      const orgId = getRouterParam(event, 'orgId');

      if (orgId === undefined || orgId === '') {
        throw notFound('org-not-found', 'No such organizer.');
      }

      const org = await deps.getOrg(orgId);

      if (org === null) {
        throw notFound('org-not-found', 'No such organizer.');
      }

      const [emails, invites] = await Promise.all([
        deps.getUserEmails(Object.keys(org.members)),
        deps.listOrgInvites(orgId),
      ]);

      return {
        org: toAdminOrg(org, emails),
        invites: invites.map((invite) =>
          toOrgInviteView(invite, deps.orgInviteStatus(invite)),
        ),
      } satisfies OrgsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
