import { requireAuth, requireOrgRole } from '@upskills/auth';
import { getEvent, updateEvent } from '@upskills/firestore';
import { getMediaStorage } from '@upskills/storage';
import { createDashboardEventsUpdateHandler } from '../../../../../../handlers/dashboard/events-update';

/**
 * `PUT /api/v1/dashboard/events/:eventId`
 *
 * Wiring only. See `handlers/dashboard/events-update.ts` for the behavior and
 * why the real `@upskills/auth` import stays in this file.
 *
 * `deleteMedia` forwards to the port per call rather than resolving it once at
 * module load, for the reason spelled out at length in `../../image.post.ts`:
 * `getMediaStorage()` reads `MEDIA_BUCKET` and throws when it is unset, so
 * resolving it here would turn a missing variable into a route that cannot
 * load — including for the overwhelming majority of updates that touch no
 * image at all.
 */
export default createDashboardEventsUpdateHandler({
  requireAuth,
  requireOrgRole,
  getEvent,
  updateEvent,
  deleteMedia: (path) => getMediaStorage().delete(path),
});
