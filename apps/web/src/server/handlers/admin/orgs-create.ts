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
import { toAdminOrg, type AdminOrg } from './admin-view';

/**
 * `POST /api/v1/admin/orgs` — create an organizer and reserve its slug.
 *
 * The creator comes from the authenticated session, never from the body:
 * `createOrg` makes them the first member and first admin. Authorization runs
 * before validation so an unauthenticated caller cannot use a malformed body as
 * a cheaper answer than 401.
 *
 * ## Why this route is not subject to the one-org-per-user limit
 *
 * Unlike its self-service twin under `handlers/dashboard/`, this route passes
 * `allowMultiple`. One org per user is the product rule for people who sign up;
 * it is not an invariant anything downstream relies on — `users/{uid}.orgIds`
 * is an array and `createOrg` appends to it. Enforcing it behind `requireAdmin`
 * only guarantees that whoever runs the platform, being a member of their own
 * organizer from the first day, can never create another one. That includes the
 * curated organizer that community events listed from other sites belong under.
 *
 * The dashboard still shows `orgs[0]`, so a platform admin with several orgs
 * manages the rest through `/admin/orgs` rather than the dashboard.
 */

export interface OrgsCreateResponse {
  org: AdminOrg;
}

export interface OrgsCreateDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `createOrg` from `@upskills/firestore`. */
  createOrg(draft: CreateOrgDraft): Promise<Organizer>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
}

export function createOrgsCreateHandler(deps: OrgsCreateDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const { uid } = await deps.requireAdmin(event);
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
        // Set here, from the fact that this is the admin route — never read
        // from the body. See `CreateOrgDraft.allowMultiple`: the one-org rule
        // is a self-service guard, and applying it to a caller who has already
        // passed `requireAdmin` only means the operator of the site can never
        // create a second organizer, having joined their own on day one.
        allowMultiple: true,
      });

      const emails = await emailsAfterWrite(
        deps.getUserEmails,
        Object.keys(org.members),
      );

      return { org: toAdminOrg(org, emails) } satisfies OrgsCreateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
