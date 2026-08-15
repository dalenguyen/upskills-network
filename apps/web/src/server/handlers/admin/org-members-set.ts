import type { AuthContext } from '@upskills/auth';
import type { Organizer, OrgRole } from '@upskills/models';
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
 * `POST` / `PUT /api/v1/admin/orgs/:orgId/members` — add a member, or change
 * an existing member's role.
 *
 * `setOrgMember` is the same operation either way: a new uid gets the role, an
 * existing uid is moved to it, and the last-admin invariant is checked inside
 * the Firestore transaction. The two methods exist so the HTTP surface reads
 * like the distinction it is making in the UI, not because the handler treats
 * them differently.
 */

export interface OrgMembersSetResponse {
  org: Organizer;
}

export interface OrgMembersSetDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `setOrgMember` from `@upskills/firestore`. */
  setOrgMember(orgId: string, uid: string, role: OrgRole): Promise<Organizer>;
}

export function createOrgMembersSetHandler(
  deps: OrgMembersSetDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      await deps.requireAdmin(event);

      const orgId = getRouterParam(event, 'orgId');

      if (orgId === undefined || orgId === '') {
        throw notFound('org-not-found', 'No such organizer.');
      }

      const parsed = OrgMemberSchema.safeParse(await readBody<unknown>(event));

      if (!parsed.success) {
        throw badRequest(
          'invalid-member',
          'Expected a JSON body of the form { "uid": "…", "role": "…" }.',
        );
      }

      const org = await deps.setOrgMember(
        orgId,
        parsed.data.uid,
        parsed.data.role,
      );

      return { org } satisfies OrgMembersSetResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
