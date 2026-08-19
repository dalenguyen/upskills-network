import type { AuthContext } from '@upskills/auth';
import type { CreateOrgDraft } from '@upskills/firestore';
import type { Organizer } from '@upskills/models';
import { CreateOrgSchema } from '@upskills/validation';
import {
  defineEventHandler,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { emailsAfterWrite } from '../member-emails';
import { toDashboardOrg, type DashboardOrg } from './org-view';

/**
 * `POST /api/v1/dashboard/orgs` — create the caller's own organizer.
 *
 * The creator comes from the authenticated session, never from the body:
 * `createOrg` makes them the first member and first admin. Authorization runs
 * before validation so an unauthenticated caller cannot use a malformed body as
 * a cheaper answer than 401.
 */

export interface DashboardOrgsCreateResponse {
  org: DashboardOrg;
}

export interface DashboardOrgsCreateDeps {
  /** `requireAuth` from `@upskills/auth`. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `createOrg` from `@upskills/firestore`. */
  createOrg(draft: CreateOrgDraft): Promise<Organizer>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
}

export function createDashboardOrgsCreateHandler(
  deps: DashboardOrgsCreateDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const { uid } = await deps.requireAuth(event);
      const parsed = CreateOrgSchema.safeParse(await readBody<unknown>(event));

      if (!parsed.success) {
        throw badRequest(
          'invalid-org',
          'Expected a JSON body of the form { "name": "…", "slug": "…" }.',
        );
      }

      const org = await deps.createOrg({
        name: parsed.data.name,
        slug: parsed.data.slug,
        createdBy: uid,
      });

      const emails = await emailsAfterWrite(
        deps.getUserEmails,
        Object.keys(org.members),
      );

      return {
        org: toDashboardOrg(org, emails),
      } satisfies DashboardOrgsCreateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
