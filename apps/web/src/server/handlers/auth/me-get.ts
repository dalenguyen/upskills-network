import type { AuthContext } from '@upskills/auth';
import type {
  OrgMembership,
  OrgRole,
  Organizer,
  PlatformRole,
  User,
} from '@upskills/models';
import { defineEventHandler, type EventHandler, type H3Event } from 'h3';
import { notFound, toHttpError } from '../http-error';

/**
 * `GET /api/v1/auth/me` — who the caller is and which organizers they belong
 * to. This is what the client's route guards read, so its shape is a contract.
 *
 * ## Membership is re-checked, not trusted
 *
 * `User.orgIds` is a denormalized mirror of the memberships held in
 * `Organizer.members`, kept for exactly this lookup — "my orgs" without a
 * query. Denormalized data drifts: a removal that updated the organizer but not
 * the user leaves an id behind, and answering from that list alone would hand
 * an ex-member the name and slug of an org they were removed from. So each
 * organizer this route fetched is checked against `members[uid]` before it is
 * returned, and the role reported is the one on the organizer document — the
 * copy that authorization itself reads.
 *
 * ## Why the organizer is projected rather than returned whole
 *
 * An `Organizer` carries `members` and `memberUids`: the uid of every person in
 * the org. The client needs the caller's own role and enough to render a
 * switcher, so that is what it gets. Shipping the whole document would export
 * the org's membership roster to every browser that loads a page.
 */

/** One organizer the caller belongs to, as the client sees it. */
export interface MeOrg {
  orgId: string;
  name: string;
  slug: string;
  /** The caller's role in *this* org. Not their platform role. */
  role: OrgRole;
}

export interface MeUser {
  uid: string;
  email: string;
  name?: string;
  role: PlatformRole;
  /** ISO-8601, because a Firestore `Timestamp` does not survive JSON intact. */
  createdAt: string;
}

export interface MeGetResponse {
  user: MeUser;
  orgs: MeOrg[];
}

export interface MeGetDeps {
  /** `requireAuth` from `@upskills/auth`. */
  requireAuth(event: H3Event): Promise<AuthContext>;
  /** `getUser` from `@upskills/firestore`. */
  getUser(uid: string): Promise<User | null>;
  /** `getOrg` from `@upskills/firestore`. */
  getOrg(orgId: string): Promise<Organizer | null>;
}

export function createMeGetHandler(deps: MeGetDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const { uid } = await deps.requireAuth(event);
      const user = await deps.getUser(uid);

      if (user === null) {
        // The session is genuine but the document behind it is gone — deleted
        // by hand, or lost. Not a 401: the credential is fine and re-signing in
        // is what fixes it (the exchange recreates the document), so the client
        // needs to be able to tell this apart from a bad cookie.
        throw notFound(
          'user-not-found',
          'No user document exists for this account.',
        );
      }

      return {
        user: {
          uid: user.uid,
          email: user.email,
          ...(user.name === undefined ? {} : { name: user.name }),
          role: user.role,
          createdAt: user.createdAt.toDate().toISOString(),
        },
        orgs: await callerOrgs(uid, user.orgIds, deps),
      } satisfies MeGetResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/** The organizers `uid` is currently a member of, in `orgIds` order. */
async function callerOrgs(
  uid: string,
  orgIds: string[],
  deps: MeGetDeps,
): Promise<MeOrg[]> {
  const orgs = await Promise.all(orgIds.map((orgId) => deps.getOrg(orgId)));

  return orgs.flatMap((org) => {
    if (org === null) {
      return [];
    }

    // Typed explicitly: `members` is a `Record`, so indexing it yields a
    // membership as far as the compiler is concerned, and a stale `orgIds`
    // entry is precisely the case where there is nothing there.
    const membership: OrgMembership | undefined = org.members[uid];

    return membership === undefined
      ? []
      : [
          {
            orgId: org.orgId,
            name: org.name,
            slug: org.slug,
            role: membership.role,
          },
        ];
  });
}
