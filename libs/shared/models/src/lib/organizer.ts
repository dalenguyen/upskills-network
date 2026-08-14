import type { Timestamp } from './timestamp';

/** Role a user holds *within* a single organizer. */
export type OrgRole = 'admin' | 'manager' | 'check_in' | 'volunteer';

/** One membership entry inside {@link Organizer.members}. */
export interface OrgMembership {
  role: OrgRole;
  addedAt: Timestamp;
}

/**
 * Organizer document: `organizers/{orgId}`.
 *
 * `members` is a map keyed by uid — not an array — because Firestore security
 * rules cannot index into an array of objects: `members[request.auth.uid]` only
 * evaluates against a map. `memberUids` exists alongside it purely so an
 * `array-contains` query can answer "which orgs does this user belong to".
 * The two fields must be written together and kept in sync.
 */
export interface Organizer {
  orgId: string;
  name: string;
  /** Unique; enforced by an `orgSlugs/{slug}` reservation doc. */
  slug: string;
  /** uid of the creator. */
  createdBy: string;
  /** Keyed by uid — map form is required by the security rules. */
  members: Record<string, OrgMembership>;
  /** Mirror of `Object.keys(members)`, for `array-contains` queries. */
  memberUids: string[];
  createdAt: Timestamp;
}
