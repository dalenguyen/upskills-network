import { createHash, timingSafeEqual } from 'node:crypto';
import type { WorkshopEvent } from '@upskills/models';
import type { MediaStorage } from '@upskills/storage';
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  type EventHandler,
} from 'h3';
import { toHttpError, type ApiErrorData } from '../http-error';

/**
 * `POST /api/v1/media/sweep` — delete abandoned hero image uploads.
 *
 * The create form uploads on file selection, not on save, so an event draft the
 * organizer never saves leaves a real object in the bucket. This handler lists
 * the bucket, unions every storage path an event actually references, and
 * deletes the unreferenced objects older than 24 hours.
 *
 * ## The grace period is the whole safety mechanism
 *
 * An organizer can have the create form open for a while, so a freshly uploaded
 * object may not be referenced by any event yet. Deleting only objects older
 * than 24 hours is what keeps that live upload safe. Two cheaper designs were
 * rejected in the spec: moving an object to a staging prefix on save would
 * invalidate the URL already sitting in the open form, and a lifecycle rule on
 * object custom-time would silently delete a live image if the save-time
 * metadata update ever failed.
 *
 * ## `imageUrl` is the single source of truth for reachability
 *
 * An object is referenced when its path is named by an event's `imageUrl` OR by
 * that event's `heroImage.storagePath`. Keying on `heroImage.storagePath` alone
 * destroys live images: editing any field of an event that has an uploaded hero
 * image drops `heroImage` while `imageUrl` still points at the live object, so
 * the sweeper would delete a published event's image 24 hours after its first
 * edit. The URL is authoritative; the bookkeeping path is unioned in for the
 * create-form window and for any event still carrying it.
 */

/** Env var holding the shared secret that authorizes a sweep. */
export const MEDIA_SWEEP_SECRET_ENV = 'MEDIA_SWEEP_SECRET';

/** Objects are deleted only once they are older than this. */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/** The header carrying the shared secret. */
const SWEEP_SECRET_HEADER = 'x-sweep-secret';

/** The bucket prefix every uploaded event image lives under. */
const SWEEP_PREFIX = 'orgs/';

export interface MediaSweepResponse {
  /** Number of objects found under the sweep prefix. */
  scanned: number;
  /** Number of unreferenced objects old enough to delete. */
  deleted: number;
  /** Number of objects left alone — referenced, too young, or unparseable. */
  spared: number;
}

export interface MediaSweepDeps {
  /** The media storage port from `@upskills/storage`. */
  storage: MediaStorage;
  /**
   * Every event across every org and every status. A cancelled event still
   * renders its image, so it must contribute to the referenced set too.
   */
  listEvents(): Promise<WorkshopEvent[]>;
  /** Clock; injectable so the 24-hour boundary is deterministic in specs. */
  now?(): Date;
}

export function createMediaSweepHandler(deps: MediaSweepDeps): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const supplied = getRequestHeader(event, SWEEP_SECRET_HEADER);

      if (!secretMatches(supplied, mediaSweepSecret())) {
        throw refuse();
      }

      const candidates = await deps.storage.list(SWEEP_PREFIX);
      const referenced = await collectReferencedPaths(deps);

      const now = (deps.now ?? (() => new Date()))();
      const cutoff = now.getTime() - SWEEP_GRACE_MS;

      let deleted = 0;

      for (const candidate of candidates) {
        const createdAtMs = candidate.createdAt.getTime();

        if (
          Number.isFinite(createdAtMs) &&
          createdAtMs < cutoff &&
          !referenced.has(candidate.path)
        ) {
          await deps.storage.delete(candidate.path);
          deleted += 1;

          console.log(
            `media-sweep: deleted orphan ${candidate.path} ` +
              `(createdAt=${candidate.createdAt.toISOString()}, ` +
              `ageHours=${((now.getTime() - createdAtMs) / 3_600_000).toFixed(1)})`,
          );
        }
      }

      return {
        scanned: candidates.length,
        deleted,
        spared: candidates.length - deleted,
      } satisfies MediaSweepResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/**
 * The set of storage paths every event references.
 *
 * ## Why an unresolvable `imageUrl` does not abort the whole sweep
 *
 * An earlier version returned `null` here — "reachability is unknown, so delete
 * nothing" — and that was a denial of service anybody could trigger.
 * `HttpsUrlSchema` accepts any https URL, so an organizer pasting
 * `https://storage.googleapis.com/foo` into one event's image field
 * permanently disabled the sweep for every org.
 *
 * Dropping the abort is safe because of where the resolvable URLs come from. A
 * referenced object's URL is not typed by a person: it is minted by
 * `publicUrlForPath` at upload time and always names the object's exact path.
 * So a URL this function cannot resolve to a path cannot be naming any object
 * in the bucket, and contributing nothing for it cannot expose a live image.
 *
 * It is still logged, because an `imageUrl` that names the media bucket without
 * naming an object in it is a sign something upstream is wrong.
 */
async function collectReferencedPaths(
  deps: MediaSweepDeps,
): Promise<Set<string>> {
  const events = await deps.listEvents();
  const referenced = new Set<string>();

  for (const workshop of events) {
    const imageUrl = workshop.imageUrl?.trim();

    if (imageUrl !== undefined && imageUrl !== '') {
      const path = storagePathFromImageUrl(imageUrl);

      if (path === undefined) {
        console.warn(
          `media-sweep: event ${workshop.orgId}/${workshop.eventId} has an ` +
            `imageUrl that names no storage object; it references nothing`,
        );
      } else if (path !== null) {
        referenced.add(path);
      }
    }

    const heroPath = workshop.heroImage?.storagePath;

    if (heroPath !== undefined && heroPath !== '') {
      referenced.add(heroPath);
    }
  }

  return referenced;
}

/**
 * The storage object path an `imageUrl` names, or `null` when it names a
 * non-storage URL, or `undefined` when it cannot be parsed.
 *
 * `undefined` is the fail-safe signal: an organizer-pasted value that is not a
 * URL could still be intended to point at an uploaded object, so the sweeper
 * must not guess which object it might name.
 */
function storagePathFromImageUrl(imageUrl: string): string | null | undefined {
  let url: URL;

  try {
    url = new URL(imageUrl);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com') {
    return null;
  }

  const segments = url.pathname.split('/');

  // `pathname` starts with `/`, so the split is ['', bucket, ...pathSegments].
  if (segments.length < 3 || segments[0] !== '') {
    return undefined;
  }

  const decodedPathSegments: string[] = [];

  for (const segment of segments.slice(2)) {
    try {
      decodedPathSegments.push(decodeURIComponent(segment));
    } catch {
      return undefined;
    }
  }

  const path = decodedPathSegments.join('/');

  return path === '' ? undefined : path;
}

/**
 * Constant-time shared-secret check, in the same shape as
 * `handlers/registration/cancel.ts`.
 *
 * Both sides are SHA-256 digested first so `timingSafeEqual` always compares
 * two 32-byte buffers and never throws on a length mismatch. A missing header
 * is compared as the empty string, so it does the same work as a wrong one.
 */
function secretMatches(
  supplied: string | undefined,
  expected: string,
): boolean {
  return timingSafeEqual(digest(supplied ?? ''), digest(expected));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * The expected sweep secret, read at call time and never at module load.
 *
 * Same reasoning as `mediaBucketName()` in `@upskills/storage`: importing this
 * module must cost nothing and assert nothing. Only the request that actually
 * sweeps needs the variable to be configured.
 */
function mediaSweepSecret(): string {
  const value = process.env[MEDIA_SWEEP_SECRET_ENV]?.trim();

  if (!value) {
    throw new Error(
      `${MEDIA_SWEEP_SECRET_ENV} is not set. The media sweep endpoint needs a ` +
        `shared secret; see apps/web/.env.example.`,
    );
  }

  return value;
}

/** The one 403 this route produces, for every reason it produces one. */
function refuse() {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'This endpoint requires the shared sweep secret.',
    data: { error: 'sweep-refused' } satisfies ApiErrorData,
  });
}
