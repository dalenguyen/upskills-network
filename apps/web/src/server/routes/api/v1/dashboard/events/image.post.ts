import { requireOrgRole } from '@upskills/auth';
import { getMediaStorage } from '@upskills/storage';
import { createDashboardEventImageUploadHandler } from '../../../../../handlers/dashboard/event-image-upload';

/**
 * `POST /api/v1/dashboard/events/image?orgId=`
 *
 * Wiring only. See `handlers/dashboard/event-image-upload.ts` for the behavior
 * and why the real `@upskills/auth` and `@upskills/storage` imports stay in
 * this file.
 */
export default createDashboardEventImageUploadHandler({
  requireOrgRole,
  storage: getMediaStorage(),
});
