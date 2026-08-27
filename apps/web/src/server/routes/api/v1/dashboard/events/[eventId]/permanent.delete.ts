import { requireAuth, requireOrgRole } from '@upskills/auth';
import { deleteDraftEvent, getEvent } from '@upskills/firestore';
import {
  getMediaStorage,
  mediaBucketName,
  type MediaStorage,
} from '@upskills/storage';
import { createDashboardEventsDeleteHandler } from '../../../../../../handlers/dashboard/events-delete';

/**
 * `DELETE /api/v1/dashboard/events/:eventId/permanent?orgId=`
 *
 * Wiring only. See `handlers/dashboard/events-delete.ts` for the behavior and
 * why this is separate from the cancelling `DELETE` next to it.
 *
 * The storage port is forwarded per call for the same reason as the image
 * upload route: `getMediaStorage()` reads `MEDIA_BUCKET` and would otherwise
 * turn a missing environment variable into a failure to load this route.
 * `mediaBucketName` reads the variable at call time, so it is passed straight
 * through.
 */
const storage: MediaStorage = {
  upload: (input) => getMediaStorage().upload(input),
  delete: (path) => getMediaStorage().delete(path),
  list: (prefix) => getMediaStorage().list(prefix),
};

export default createDashboardEventsDeleteHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  deleteDraftEvent,
  storage,
  mediaBucketName,
});
