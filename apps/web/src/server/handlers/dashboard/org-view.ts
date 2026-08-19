import type { Organizer, OrgMembership } from '@upskills/models';

/**
 * The projection the organizer's own org routes answer with.
 *
 * Unlike {@link PublicOrg} this is not a narrowing: the caller has already
 * passed `requireOrgRole`, so the org's own staff roster is theirs to see. The
 * only thing that changes on the way to the wire is the timestamp format — a
 * Firestore `Timestamp` serializes to `{"_seconds":…,"_nanoseconds":…}`, a
 * plain object with no `toDate()`, so a browser that trusted the `Organizer`
 * type would compile and then throw `createdAt.toDate is not a function` on the
 * first org it rendered.
 *
 * The shape mirrors `DashboardEvent`: every `Organizer` field is kept, and its
 * timestamp-bearing fields are re-typed as ISO-8601 strings. It is deliberately
 * not the platform-admin projection: those routes ship the same roster to a
 * platform admin, these ship it to a member of that org, and the two
 * projections are free to drift later.
 */

/** One membership entry as an org member sees it. */
export interface DashboardOrgMembership extends Omit<OrgMembership, 'addedAt'> {
  /** ISO-8601 — see the module comment. */
  addedAt: string;
  /**
   * The member's email, from `users/{uid}`, or `null` when none was resolved —
   * a membership can name a uid whose user document is gone. The dashboard
   * falls back to the uid, so a roster still renders either way.
   */
  email: string | null;
}

/** An organizer as its own members see it. */
export interface DashboardOrg extends Omit<Organizer, 'createdAt' | 'members'> {
  createdAt: string;
  /** Keyed by uid — the full staff roster, `addedAt` serialized. */
  members: Record<string, DashboardOrgMembership>;
}

/**
 * Serialize one organizer for its own dashboard, timestamps included.
 *
 * @param emails uid → email, from `getUserEmails`.
 */
export function toDashboardOrg(
  org: Organizer,
  emails: Record<string, string> = {},
): DashboardOrg {
  const { createdAt, members, ...rest } = org;

  return {
    ...rest,
    createdAt: createdAt.toDate().toISOString(),
    members: Object.fromEntries(
      Object.entries(members).map(
        ([uid, membership]): [string, DashboardOrgMembership] => [
          uid,
          {
            role: membership.role,
            addedAt: membership.addedAt.toDate().toISOString(),
            email: emails[uid] ?? null,
          },
        ],
      ),
    ),
  };
}
