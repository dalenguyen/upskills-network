import type { OrgRole, Organizer, PlatformRole, User } from '@upskills/models';
import { getOrg, getUser } from '@upskills/firestore';
import { getCookie, type H3Event } from 'h3';
import {
  SESSION_COOKIE_NAME,
  verifySessionCookie,
  type SessionUser,
  type VerifyingAuth,
} from './session-cookie';

/**
 * The three guards every mutating route calls before it does anything else.
 *
 * ## Why the platform role is read from Firestore and not from the cookie
 *
 * The session cookie carries an `admin` claim, and reading it would save a
 * document read per request. It would also be wrong. As `admin-claim.ts`
 * explains, the claim is a cache written at token-mint time: it lags a role
 * change by up to an hour on an ID token and by the cookie's full five days on
 * a session cookie. A demoted admin would keep passing {@link requireAdmin} for
 * days. The claim exists so *security rules* can check authority without a
 * document read, because rules have no alternative; server code has a live
 * Firestore connection and no excuse. `users/{uid}.role` is the source of
 * truth, and it is what these guards read.
 *
 * ## Why a guard never says "not found"
 *
 * A guard answers 401 or 403 and nothing else. That is not a style choice: a
 * guard that answered 404 for a missing organizer would be a membership oracle,
 * because "403" and "404" are different answers and an outsider probing
 * `/api/orgs/{id}/...` could tell which org ids exist by the status code alone.
 * {@link Guards.requireOrgRole} therefore returns the same 403 whether the org
 * does not exist, the caller is not a member, or the caller is a member without
 * the required role.
 *
 * The corresponding trap is at the call site, and documentation is not enough
 * to prevent it — a route that reads the org first to 404 on it, and only then
 * calls the guard, leaks exactly the same thing before the guard ever runs. So
 * `requireOrgRole` hands the organizer document back on {@link OrgContext.org}:
 * the route already has what it would have fetched, in a code path that cannot
 * be reached without passing authorization first, and the tempting early read
 * has nothing left to offer.
 */

/** What a caller proved by presenting a valid session cookie. */
export interface AuthContext {
  uid: string;
  /**
   * Platform role from `users/{uid}` — **not** from the cookie's claim.
   *
   * Defaults to `'user'` when the document is missing. Least privilege: an
   * account Firestore has never heard of is an ordinary user, and a missing
   * document must never be readable as authority.
   */
  role: PlatformRole;
  /** The verified session, for callers that need a claim or the expiry. */
  session: SessionUser;
}

/** What a caller proved about one organizer. */
export interface OrgContext extends AuthContext {
  orgId: string;
  /**
   * The caller's authority within this org. A platform admin is reported as
   * `'admin'` here whatever their membership says (or if they have none) —
   * see {@link viaPlatformAdmin} to tell the two apart.
   */
  orgRole: OrgRole;
  /**
   * `true` when the caller passed on platform authority rather than
   * membership. Worth branching on for an audit log: "a staff member acted on
   * your org" is a different event from "your manager did".
   */
  viaPlatformAdmin: boolean;
  /**
   * The organizer document the guard already read.
   *
   * Returned so the route does not read it again — and, more to the point, so
   * it has no reason to read it *before* authorizing. See the module comment.
   */
  org: Organizer;
}

/**
 * Raised when an authenticated caller lacks the authority for this operation.
 *
 * Distinct from `InvalidSessionError` (401) on purpose. 401 means "I do not
 * know who you are, sign in"; 403 means "I know exactly who you are and the
 * answer is no". Answering 401 here would send a perfectly valid session into a
 * re-login loop that cannot possibly help, and would teach the client to
 * discard good cookies.
 *
 * `message` names what was required, for the server log. It is written for an
 * operator, not for the client — a route should answer the bare `status` and
 * must not echo it, since it names roles and org ids the caller may not know
 * about.
 */
export class ForbiddenError extends Error {
  /** What a route should answer. */
  readonly status = 403;

  constructor(
    readonly uid: string,
    message: string,
  ) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** The Firestore reads a guard needs. Satisfied by `@upskills/firestore`. */
export interface GuardReads {
  getUser(uid: string): Promise<User | null>;
  getOrg(orgId: string): Promise<Organizer | null>;
}

export interface GuardDeps {
  /** Injected Auth client; production leaves it unset. */
  auth?: VerifyingAuth;
  /** Injected reads; production leaves them unset. */
  reads?: GuardReads;
}

export interface Guards {
  requireAuth(event: H3Event): Promise<AuthContext>;
  requireAdmin(event: H3Event): Promise<AuthContext>;
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
}

const PRODUCTION_READS: GuardReads = { getUser, getOrg };

/**
 * Build the three guards over a given Auth client and set of reads.
 *
 * The exported {@link requireAuth}, {@link requireAdmin} and
 * {@link requireOrgRole} are this factory wired to production, and are what
 * routes should use. The factory exists because `requireOrgRole` takes its
 * roles as rest parameters — `requireOrgRole(event, orgId, 'admin', 'manager')`
 * reads the way the permission does — and a trailing options argument cannot
 * coexist with that. Injecting once, here, keeps the call sites clean and gives
 * the tests a seam. It also lets the guards call each other directly, which is
 * the behavior worth preserving: every guard begins with `requireAuth`.
 */
export function createGuards(deps: GuardDeps = {}): Guards {
  const reads = deps.reads ?? PRODUCTION_READS;
  const sessionOptions = deps.auth === undefined ? {} : { auth: deps.auth };

  async function requireAuth(event: H3Event): Promise<AuthContext> {
    // Throws `InvalidSessionError` (status 401) for a cookie that is missing,
    // expired, revoked, malformed, or attached to a disabled account. Not
    // re-wrapped: that type already carries the right status and a reason.
    const session = await verifySessionCookie(
      getCookie(event, SESSION_COOKIE_NAME),
      sessionOptions,
    );

    const user = await reads.getUser(session.uid);

    return { uid: session.uid, role: user?.role ?? 'user', session };
  }

  async function requireAdmin(event: H3Event): Promise<AuthContext> {
    const context = await requireAuth(event);

    if (context.role !== 'admin') {
      throw new ForbiddenError(
        context.uid,
        'Platform role "admin" is required for this operation.',
      );
    }

    return context;
  }

  async function requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext> {
    if (roles.length === 0) {
      // A programming error, not an authorization failure — and deliberately
      // not silently permissive. `roles.includes(...)` over an empty list is
      // always false, so the alternative reading ("any member will do") would
      // have to be a special case, and a guard whose most permissive meaning is
      // spelled by writing nothing is a guard someone will get wrong.
      throw new Error(
        `requireOrgRole("${orgId}") was called with no roles; name the roles that may perform this operation.`,
      );
    }

    const context = await requireAuth(event);
    const org = await reads.getOrg(orgId);

    // Every failure below is the same 403 with the same message shape. A caller
    // cannot distinguish "no such org" from "not your org" from "wrong role",
    // which is the point.
    const refuse = (): never => {
      throw new ForbiddenError(
        context.uid,
        `One of [${roles.join(', ')}] in org "${orgId}" is required for this operation.`,
      );
    };

    if (context.role === 'admin') {
      // Platform admins pass for any org — but not for one that does not
      // exist. There is nothing to act on, and inventing a context around a
      // missing document would hand the route an `org` it cannot trust.
      return org
        ? { ...context, orgId, org, orgRole: 'admin', viaPlatformAdmin: true }
        : refuse();
    }

    const orgRole = org?.members[context.uid]?.role;

    if (org === null || orgRole === undefined || !roles.includes(orgRole)) {
      return refuse();
    }

    return { ...context, orgId, org, orgRole, viaPlatformAdmin: false };
  }

  return { requireAuth, requireAdmin, requireOrgRole };
}

const guards = createGuards();

/**
 * Require a valid session. Throws `InvalidSessionError` (401) if there is not
 * one; resolves to the caller's uid and platform role.
 */
export const requireAuth = guards.requireAuth;

/**
 * Require a platform admin. Throws 401 without a session, 403 with one that is
 * not an admin.
 */
export const requireAdmin = guards.requireAdmin;

/**
 * Require one of `roles` within `orgId`, or platform admin.
 *
 * ```ts
 * const { org, orgRole } = await requireOrgRole(event, orgId, 'admin', 'manager');
 * ```
 *
 * Throws 401 without a session and 403 for every authorization failure —
 * including an org that does not exist, which is indistinguishable from one the
 * caller may not see. The organizer document comes back on the context so the
 * route never needs to read it first.
 */
export const requireOrgRole = guards.requireOrgRole;
