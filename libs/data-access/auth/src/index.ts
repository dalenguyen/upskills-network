export { getAdminAuth } from './lib/admin-auth';

export {
  DEFAULT_MAX_AUTH_AGE_MS,
  DEFAULT_SESSION_LIFETIME_MS,
  InvalidSessionError,
  MAX_SESSION_LIFETIME_MS,
  MIN_SESSION_LIFETIME_MS,
  SESSION_COOKIE_NAME,
  clampSessionLifetime,
  clearedSessionCookie,
  createSessionCookie,
  revokeSessions,
  verifySessionCookie,
} from './lib/session-cookie';
export type {
  CreateSessionCookieOptions,
  MintedSession,
  MintingAuth,
  RevokeSessionsOptions,
  RevokingAuth,
  SessionCookieAttributes,
  SessionRejection,
  SessionUser,
  VerifySessionCookieOptions,
  VerifyingAuth,
} from './lib/session-cookie';

export {
  ForbiddenError,
  createGuards,
  requireAdmin,
  requireAuth,
  requireOrgRole,
} from './lib/guards';
export type {
  AuthContext,
  GuardDeps,
  GuardReads,
  Guards,
  OrgContext,
} from './lib/guards';

export {
  ADMIN_CLAIM,
  syncAdminClaim,
  withAdminClaimMirrored,
} from './lib/admin-claim';
export type {
  ClaimsAuth,
  CustomClaims,
  MirrorAdminClaimOptions,
  MirrorAdminClaimResult,
  SyncAdminClaimOptions,
  SyncAdminClaimResult,
} from './lib/admin-claim';
