import { badRequest } from '../http-error';

/**
 * Turn a rejected cursor into a 400, and let everything else through.
 *
 * `decodeEventCursor` throws a plain `Error('Invalid cursor')` for anything that
 * is not one of ours — bad base64, valid base64 that decodes to the wrong
 * shape, a truncated query string. All of those are caller error, so they
 * answer 400 rather than surfacing as a 500.
 *
 * Every paginated public route shares this so a client sees one
 * `invalid-cursor` code with one recovery ("start from the first page"),
 * whichever listing it was reading. Matching on the message is deliberate but
 * narrow: it is the only string that read helper throws, and the alternative —
 * exporting an error class from the firestore lib purely so a route can
 * `instanceof` it — would put an HTTP concern in the data layer.
 */
export function rethrowAsBadCursor(error: unknown): never {
  if (error instanceof Error && error.message === 'Invalid cursor') {
    throw badRequest(
      'invalid-cursor',
      'That page cursor is not valid. Start from the first page.',
    );
  }

  throw error;
}
