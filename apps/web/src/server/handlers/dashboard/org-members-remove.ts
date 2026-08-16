import type { OrgContext } from '@upskills/auth';
import type { Organizer, OrgRole } from '@upskills/models';
import { OrgMemberSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { toDashboardOrg, type DashboardOrg } from './org-view';

/**
 * `DELETE /api/v1/dashboard/orgs/:orgId/members` — remove one member.
 *
 * Only an org admin may manage members. Removal takes a uid and nothing else;
 * `role` is ignored by design because a delete is not a role change. The body
 * shape is derived from {@link OrgMemberSchema} rather than redeclared, so the
 * uid rule stays in the validation lib.
 */

const OrgMemberRemovalSchema = OrgMemberSchema.pick({ uid: true });

export interface DashboardOrgMembersRemoveResponse {
  org: DashboardOrg;
}

export interface DashboardOrgMembersRemoveDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `removeOrgMember` from `@upskills/firestore`. */
  removeOrgMember(orgId: string, uid: string): Promise<Organizer>;
}

export function createDashboardOrgMembersRemoveHandler(
  deps: DashboardOrgMembersRemoveDeps,
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

      const parsed = OrgMemberRemovalSchema.safeParse(
        await readBody<unknown>(event),
      );

      if (!parsed.success) {
        throw badRequest(
          'invalid-member',
          'Expected a JSON body of the form { "uid": "…" }.',
        );
      }

      const org = await deps.removeOrgMember(orgId, parsed.data.uid);

      return {
        org: toDashboardOrg(org),
      } satisfies DashboardOrgMembersRemoveResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
