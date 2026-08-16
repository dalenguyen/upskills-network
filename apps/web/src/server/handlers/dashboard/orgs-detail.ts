import type { OrgContext } from '@upskills/auth';
import type { OrgRole } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError } from '../http-error';
import { toDashboardOrg, type DashboardOrg } from './org-view';

/**
 * `GET /api/v1/dashboard/orgs/:orgId` — the caller's own organizer.
 *
 * Unlike the admin org detail this never reads the org itself: `requireOrgRole`
 * returns the organizer document on {@link OrgContext.org} only after the
 * caller has passed authorization. A missing org, a non-member, and a member
 * with the wrong role are all the same 403 from the guard, so probing org ids
 * cannot learn which ones exist. Any member role may read the org; the roster
 * is only ever answered to someone already in it.
 */

export interface DashboardOrgsDetailResponse {
  org: DashboardOrg;
}

export interface DashboardOrgsDetailDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
}

export function createDashboardOrgsDetailHandler(
  deps: DashboardOrgsDetailDeps,
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

      const context = await deps.requireOrgRole(
        event,
        orgId,
        'admin',
        'manager',
        'check_in',
        'volunteer',
      );

      return {
        org: toDashboardOrg(context.org),
      } satisfies DashboardOrgsDetailResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
