import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { OrgMemberSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, notFound, toHttpError } from '../http-error';

/**
 * `DELETE /api/v1/admin/orgs/:orgId/members` — remove one member.
 *
 * Removal takes a uid and nothing else; `role` is ignored by design because a
 * delete is not a role change. The body shape is derived from
 * {@link OrgMemberSchema} rather than redeclared, so the uid rule stays in the
 * validation lib.
 */

const OrgMemberRemovalSchema = OrgMemberSchema.pick({ uid: true });

export interface OrgMembersRemoveResponse {
  org: Organizer;
}

export interface OrgMembersRemoveDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `removeOrgMember` from `@upskills/firestore`. */
  removeOrgMember(orgId: string, uid: string): Promise<Organizer>;
}

export function createOrgMembersRemoveHandler(
  deps: OrgMembersRemoveDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      await deps.requireAdmin(event);

      const orgId = getRouterParam(event, 'orgId');

      if (orgId === undefined || orgId === '') {
        throw notFound('org-not-found', 'No such organizer.');
      }

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

      return { org } satisfies OrgMembersRemoveResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
