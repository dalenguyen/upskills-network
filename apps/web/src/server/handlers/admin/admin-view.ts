import type { Organizer, OrgMembership } from '@upskills/models';

/**
 * The projection the platform-admin org routes answer with.
 *
 * Unlike {@link PublicOrg} this is not a narrowing: the admin console is the
 * one surface allowed to see the full org document, staff roster included. The
 * only thing that changes on the way to the wire is the timestamp format — a
 * Firestore `Timestamp` serializes to `{"_seconds":…,"_nanoseconds":…}`, a
 * plain object with no `toDate()`, so a browser that trusted the `Organizer`
 * type would compile and then throw `createdAt.toDate is not a function` on the
 * first org it rendered.
 *
 * The shape mirrors `DashboardEvent`: every `Organizer` field is kept, and its
 * timestamp-bearing fields are re-typed as ISO-8601 strings.
 */

/** One membership entry as the admin console sees it. */
export interface AdminOrgMembership extends Omit<OrgMembership, 'addedAt'> {
  /** ISO-8601 — see the module comment. */
  addedAt: string;
}

/** An organizer as the platform-admin console sees it. */
export interface AdminOrg extends Omit<Organizer, 'createdAt' | 'members'> {
  createdAt: string;
  /** Keyed by uid — the full staff roster, `addedAt` serialized. */
  members: Record<string, AdminOrgMembership>;
}

/** Serialize one organizer for the admin console, timestamps included. */
export function toAdminOrg(org: Organizer): AdminOrg {
  const { createdAt, members, ...rest } = org;

  return {
    ...rest,
    createdAt: createdAt.toDate().toISOString(),
    members: Object.fromEntries(
      Object.entries(members).map(
        ([uid, membership]): [string, AdminOrgMembership] => [
          uid,
          {
            role: membership.role,
            addedAt: membership.addedAt.toDate().toISOString(),
          },
        ],
      ),
    ),
  };
}
