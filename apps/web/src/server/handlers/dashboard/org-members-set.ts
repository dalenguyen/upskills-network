import type { OrgContext } from '@upskills/auth';
import type { Organizer, OrgRole, User } from '@upskills/models';
import { SetOrgMemberSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { emailsAfterWrite } from '../member-emails';
import { resolveMemberUid } from '../member-uid';
import { toDashboardOrg, type DashboardOrg } from './org-view';

/**
 * `POST` / `PUT /api/v1/dashboard/orgs/:orgId/members` — add a member, or
 * change an existing member's role.
 *
 * Only an org admin may manage members. `setOrgMember` is the same operation
 * either way: a new uid gets the role, an existing uid is moved to it, and the
 * last-admin invariant is checked inside the Firestore transaction. The two
 * methods exist so the HTTP surface reads like the distinction it is making in
 * the UI, not because the handler treats them differently.
 *
 * The body may name the member by `uid` or by `email`; see `member-uid.ts` for
 * why an email that belongs to no account is a 404 rather than an invitation.
 */

export interface DashboardOrgMembersSetResponse {
  org: DashboardOrg;
}

export interface DashboardOrgMembersSetDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `setOrgMember` from `@upskills/firestore`. */
  setOrgMember(orgId: string, uid: string, role: OrgRole): Promise<Organizer>;
  /** `findUserByEmail` from `@upskills/firestore`. */
  findUserByEmail(email: string): Promise<User | null>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
}

export function createDashboardOrgMembersSetHandler(
  deps: DashboardOrgMembersSetDeps,
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

      // Authorization before body validation, so a caller without access
      // cannot use a malformed body as a cheaper answer than 403.
      await deps.requireOrgRole(event, orgId, 'admin');

      const parsed = SetOrgMemberSchema.safeParse(
        await readBody<unknown>(event),
      );

      if (!parsed.success) {
        throw badRequest(
          'invalid-member',
          'Expected a JSON body of the form { "email": "…", "role": "…" } or { "uid": "…", "role": "…" }.',
        );
      }

      const uid = await resolveMemberUid(deps, parsed.data);

      const org = await deps.setOrgMember(orgId, uid, parsed.data.role);
      const emails = await emailsAfterWrite(
        deps.getUserEmails,
        Object.keys(org.members),
      );

      return {
        org: toDashboardOrg(org, emails),
      } satisfies DashboardOrgMembersSetResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
