import type { AuthContext } from '@upskills/auth';
import type { Organizer, OrgRole, User } from '@upskills/models';
import { SetOrgMemberSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, notFound, toHttpError } from '../http-error';
import { emailsAfterWrite } from '../member-emails';
import { resolveMemberUid } from '../member-uid';
import { toAdminOrg, type AdminOrg } from './admin-view';

/**
 * `POST` / `PUT /api/v1/admin/orgs/:orgId/members` — add a member, or change
 * an existing member's role.
 *
 * `setOrgMember` is the same operation either way: a new uid gets the role, an
 * existing uid is moved to it, and the last-admin invariant is checked inside
 * the Firestore transaction. The two methods exist so the HTTP surface reads
 * like the distinction it is making in the UI, not because the handler treats
 * them differently.
 *
 * The body may name the member by `uid` or by `email`. An email is resolved to
 * a uid here, against `users/{uid}` — the membership is still stored under the
 * uid, because that is the key the security rules and `memberUids` are built
 * on. An email nobody has signed in with is a 404 rather than a silent no-op:
 * this cannot invite someone who does not have an account yet.
 */

export interface OrgMembersSetResponse {
  org: AdminOrg;
}

export interface OrgMembersSetDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `setOrgMember` from `@upskills/firestore`. */
  setOrgMember(orgId: string, uid: string, role: OrgRole): Promise<Organizer>;
  /** `findUserByEmail` from `@upskills/firestore`. */
  findUserByEmail(email: string): Promise<User | null>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
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

      return { org: toAdminOrg(org, emails) } satisfies OrgMembersSetResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
