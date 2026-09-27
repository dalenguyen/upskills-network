import type { EventTimeframe } from '@upskills/validation';
import { badRequest } from '../http-error';

/**
 * Read `?when=`, which may legitimately be absent.
 *
 * Absent means upcoming — the read helper's default — so it is returned as
 * `undefined` and the option is left off rather than spelled out. Anything other
 * than `upcoming` or `past` answers 400: guessing would silently hand back the
 * wrong list.
 */
export function parseTimeframe(raw: unknown): EventTimeframe | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }

  if (raw === 'upcoming' || raw === 'past') {
    return raw;
  }

  throw badRequest('invalid-when', "when must be 'upcoming' or 'past'.");
}
