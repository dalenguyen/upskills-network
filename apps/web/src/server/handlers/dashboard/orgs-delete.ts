import type { OrgContext } from '@upskills/auth';
import type { OrgRole } from '@upskills/models';
import {
  defineEventHandler,
  getRouterParam,
  type EventHandler,
  type H3Event,
} from 'h3';
import { notFound, toHttpError } from '../http-error';

/**
 * `DELETE /api/v1/dashboard/orgs/:orgId` — delete an organizer that owns no
 * events.
 *
 * Admin-only, and narrow on purpose. `deleteOrg` refuses an organizer with any
 * event still under it (`OrgNotEmptyError` → 409) rather than cascading: a
 * recursive delete across events and their guest subcollections can fail
 * halfway, and what it would be destroying is the payment record. The organizer
 * clears their events first — cancelling the public ones, permanently deleting
 * the drafts — and only then can the organizer itself go.
 *
 * Deleting releases the org slug and strips the org from every member's
 * `orgIds`, both in the same commit. That second part is what lets a member
 * create a new organizer afterwards, since `createOrg` enforces
 * one-org-per-user by reading exactly that field.
 */

export interface DashboardOrgsDeleteResponse {
  orgId: string;
  deleted: true;
}

export interface DashboardOrgsDeleteDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** `deleteOrg` from `@upskills/firestore`. */
  deleteOrg(orgId: string): Promise<void>;
}

export function createDashboardOrgsDeleteHandler(
  deps: DashboardOrgsDeleteDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = getRouterParam(event, 'orgId');

      if (orgId === undefined || orgId === '') {
        throw notFound('org-not-found', 'No such organizer.');
      }

      await deps.requireOrgRole(event, orgId, 'admin');
      await deps.deleteOrg(orgId);

      return { orgId, deleted: true } satisfies DashboardOrgsDeleteResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}
