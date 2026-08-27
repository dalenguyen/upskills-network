import { requireOrgRole } from '@upskills/auth';
import { getMediaStorage, type MediaStorage } from '@upskills/storage';
import { createDashboardEventImageUploadHandler } from '../../../../../handlers/dashboard/event-image-upload';

/**
 * `POST /api/v1/dashboard/events/image?orgId=`
 *
 * Wiring only. See `handlers/dashboard/event-image-upload.ts` for the behavior
 * and why the real `@upskills/auth` and `@upskills/storage` imports stay in
 * this file.
 *
 * ## Why the port is resolved per call rather than once at module load
 *
 * `getMediaStorage()` reads `MEDIA_BUCKET` and throws when it is unset. This
 * module is evaluated when the route is loaded, not when it is called, so
 * calling it here directly would turn a missing environment variable into a
 * failure to load the route — and `@upskills/storage` is explicit that
 * importing it must cost nothing and assert nothing, precisely so that a
 * deployment missing the variable still serves every route that never uploads.
 * Forwarding each call keeps the failure where it belongs: on the one request
 * that actually needed the bucket. `getMediaStorage()` memoizes, so the
 * indirection costs a property lookup.
 */
const storage: MediaStorage = {
  upload: (input) => getMediaStorage().upload(input),
  delete: (path) => getMediaStorage().delete(path),
  list: (prefix) => getMediaStorage().list(prefix),
};

export default createDashboardEventImageUploadHandler({
  requireOrgRole,
  storage,
});
