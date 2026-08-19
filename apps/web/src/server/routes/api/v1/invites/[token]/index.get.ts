import {
  findOrgInviteByToken,
  getOrg,
  orgInviteStatus,
} from '@upskills/firestore';
import { createInviteDetailHandler } from '../../../../../handlers/invites/invite-accept';

/**
 * `GET /api/v1/invites/:token`
 *
 * Wiring only. See `handlers/invites/invite-accept.ts` for the behavior, and
 * why this one route is readable without a session.
 */
export default createInviteDetailHandler({
  findOrgInviteByToken,
  orgInviteStatus,
  getOrg,
});
