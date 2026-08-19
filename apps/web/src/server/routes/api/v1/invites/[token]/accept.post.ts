import { requireAuth } from '@upskills/auth';
import {
  acceptOrgInvite,
  findOrgInviteByToken,
  getUser,
  orgInviteStatus,
} from '@upskills/firestore';
import { createInviteAcceptHandler } from '../../../../../handlers/invites/invite-accept';

/**
 * `POST /api/v1/invites/:token/accept`
 *
 * Wiring only. See `handlers/invites/invite-accept.ts` for the behavior and why
 * the real `@upskills/auth` import stays in this file.
 */
export default createInviteAcceptHandler({
  requireAuth,
  findOrgInviteByToken,
  orgInviteStatus,
  getUser,
  acceptOrgInvite,
});
