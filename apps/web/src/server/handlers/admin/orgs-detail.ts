import type { AuthContext } from '@upskills/auth';
import type { Organizer } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';
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
}

export interface OrgsDetailDeps {
  /** `requireAdmin` from `@upskills/auth`. */
  requireAdmin(event: H3Event): Promise<AuthContext>;
  /** `getOrg` from `@upskills/firestore`. */
  getOrg(orgId: string): Promise<Organizer | null>;
  /** `getUserEmails` from `@upskills/firestore`. */
  getUserEmails(uids: string[]): Promise<Record<string, string>>;
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

      const emails = await deps.getUserEmails(Object.keys(org.members));

      return { org: toAdminOrg(org, emails) } satisfies OrgsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
