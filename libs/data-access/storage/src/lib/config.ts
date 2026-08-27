/**
 * Where this library learns which bucket to write to, and how long the objects
 * it writes may be cached.
 *
 * ## Everything is read at call time, never at module load
 *
 * The same reasoning as `@upskills/email`'s config: reading the bucket name into
 * a module constant makes the library unimportable anywhere the variable is
 * absent. The test suite, the SSR bundle, and any route that only reads all
 * import this lib without ever uploading, so importing it must cost nothing and
 * assert nothing. Only the call that actually touches the bucket has to be
 * configured.
 */

/**
 * Name of the Cloud Storage bucket holding user-uploaded media.
 *
 * Supplied by Cloud Run (see `apps/web/project.json`) and by `apps/web/.env`
 * locally. Deliberately not defaulted: writing to a guessed bucket name is a
 * silent, wrong success, whereas an unset variable fails loudly at the one call
 * that needed it.
 */
export const MEDIA_BUCKET_ENV = 'MEDIA_BUCKET';

/**
 * `Cache-Control` written onto every uploaded object.
 *
 * Cloud Storage's own default for a public object is `public, max-age=3600`,
 * and that default is a trap for this feature: deleting an object does **not**
 * make its URL stop working, because the edge keeps serving the bytes for the
 * rest of the hour. Verified directly against this bucket — after a successful
 * delete the plain URL still returned 200 with `age: 15`, while the same URL
 * with a cache-busting query returned 404.
 *
 * The value below leans into that rather than fighting it. Object names carry
 * an unguessable media id and are never rewritten in place — replacing a hero
 * image mints a new id and therefore a new URL — so the bytes at any given URL
 * are genuinely immutable and a long cache is correct. What it costs is that a
 * deleted image stays retrievable by anyone who already had its exact URL. That
 * is acceptable for a public event hero image and would not be for anything
 * private; a private bucket would need a short max-age and signed URLs instead.
 */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * The configured media bucket name.
 *
 * @throws if `MEDIA_BUCKET` is unset or blank. An empty string is treated as
 * absent on purpose: a variable that failed to inject usually surfaces as `''`,
 * and the Cloud Storage client would turn that into a confusing 404 on a bucket
 * named the empty string rather than saying it was never configured.
 */
export function mediaBucketName(): string {
  const value = process.env[MEDIA_BUCKET_ENV]?.trim();

  if (!value) {
    throw new Error(
      `${MEDIA_BUCKET_ENV} is not set. Media uploads need a Cloud Storage ` +
        `bucket name; see apps/web/.env.example.`,
    );
  }

  return value;
}

/**
 * The public URL an object in the media bucket is served from.
 *
 * The bucket grants `allUsers` object read, so this plain form works with no
 * signing and no token. Each path segment is encoded separately so that the
 * slashes separating them survive while anything unusual inside a segment does
 * not break the URL.
 *
 * @throws if any segment is empty, `.`, or `..`. Percent-encoding does not
 * neutralise those: `.` is an unreserved character, so `encodeURIComponent`
 * returns `..` unchanged and the traversal survives into the URL, where an
 * intermediary is free to resolve `orgs/a/../b/x.jpg` down to `orgs/b/x.jpg`.
 * Object paths are built server-side today, but the extension in a media path
 * is derived from an uploaded file, so the guard belongs at the seam rather
 * than in each caller.
 */
export function publicUrlForPath(bucket: string, objectPath: string): string {
  const segments = objectPath.split('/');

  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(
        `Invalid object path ${JSON.stringify(objectPath)}: a path segment may ` +
          `not be empty, "." or "..".`,
      );
    }
  }

  const encodedPath = segments
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${encodedPath}`;
}
