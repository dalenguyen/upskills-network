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
import { toAdminOrg, type AdminOrg } from './admin-view';

/**
 * `POST /api/v1/admin/orgs` — create an organizer and reserve its slug.
 *
 * The creator comes from the authenticated session, never from the body:
 * `createOrg` makes them the first member and first admin. Authorization runs
 * before validation so an unauthenticated caller cannot use a malformed body as
 * a cheaper answer than 401.
 */

export interface OrgsCreateResponse {
  org: AdminOrg;
}

export interface OrgsCreateDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `createOrg` from `@upskills/firestore`. */
  createOrg(draft: CreateOrgDraft): Promise<Organizer>;
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
      });

      return { org: toAdminOrg(org) } satisfies OrgsCreateResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
