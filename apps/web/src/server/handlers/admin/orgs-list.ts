import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { toHttpError } from '../http-error';
import { toAdminOrg, type AdminOrg } from './admin-view';

/**
 * `GET /api/v1/admin/orgs` — every organizer, oldest first.
 *
 * Platform-admin only. The read itself lives in `@upskills/firestore`; this
 * handler owns the HTTP boundary: authorization, then the call, then the
 * response shape.
 */

export interface OrgsListResponse {
  orgs: AdminOrg[];
}

export interface OrgsListDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `listOrgs` from `@upskills/firestore`. */
  listOrgs(): Promise<Organizer[]>;
}

export function createOrgsListHandler(deps: OrgsListDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      await deps.requireAdmin(event);

      return {
        orgs: (await deps.listOrgs()).map(toAdminOrg),
      } satisfies OrgsListResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
