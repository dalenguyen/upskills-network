import type {
  AdminOrg,
  AdminOrgMembership,
} from '../../server/handlers/admin/admin-view';
import type { OrgsCreateResponse } from '../../server/handlers/admin/orgs-create';
import type { OrgsListResponse } from '../../server/handlers/admin/orgs-list';

/**
 * The platform-admin org API, as the browser sees it.
 *
 * ## Why the types come from the server handlers
 *
 * Every import from `src/server` here is `import type`, so nothing from the
 * server survives into the browser bundle — the declarations are erased at
 * compile time and the runtime graph is unchanged. What they buy is that the
 * admin pages and the routes they call cannot drift apart silently: renaming a
 * field in `AdminOrg`, `OrgsListResponse`, or `OrgsCreateResponse` breaks the
 * type-check here instead of producing an `undefined` on a rendered page.
 */

export type { AdminOrg, AdminOrgMembership };
export type { OrgsCreateResponse };
export type { OrgsListResponse };

/** `GET` — every organizer, oldest first. */
export function adminOrgsEndpoint(): string {
  return '/api/v1/admin/orgs';
}

/** `POST` — create an organizer and reserve its slug. */
export function adminOrgCreateEndpoint(): string {
  return '/api/v1/admin/orgs';
}
