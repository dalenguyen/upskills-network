import { listAllEvents } from '@upskills/firestore';
import { getMediaStorage, type MediaStorage } from '@upskills/storage';
import { createMediaSweepHandler } from '../../../../handlers/media/sweep-orphans';

/**
 * `POST /api/v1/media/sweep`
 *
 * Wiring only. See `handlers/media/sweep-orphans.ts` for the behavior, the
 * shared-secret guard, and why reachability is keyed on `imageUrl`.
 *
 * ## Why the port is resolved per call rather than once at module load
 *
 * `getMediaStorage()` reads `MEDIA_BUCKET` and throws when it is unset, and
 * this module is evaluated when the route is loaded rather than when it is
 * called. Resolving it here directly would turn a missing environment variable
 * into a failure to load the route — and because Nitro bundles every route
 * together, that failure would not stay local to this one. Forwarding each call
 * keeps it where it belongs: on the one request that actually needed the
 * bucket. Same reasoning, and the same shape, as
 * `routes/api/v1/dashboard/events/image.post.ts`.
 *
 * ## No auth guard
 *
 * There is no session here. The caller is Cloud Scheduler, which has no user,
 * so the shared secret in the request header is the entire authorization — see
 * the handler.
 */
const storage: MediaStorage = {
  upload: (input) => getMediaStorage().upload(input),
  delete: (path) => getMediaStorage().delete(path),
  list: (prefix) => getMediaStorage().list(prefix),
};

export default createMediaSweepHandler({
  storage,
  listEvents: () => listAllEvents(),
});
