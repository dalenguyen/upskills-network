import type { RegisterResponse } from '../../server/handlers/registration/register';
import type { PublicEvent } from '../../server/handlers/public/public-view';

/**
 * The public event API, as the browser sees it.
 *
 * ## Why the types come from the server handlers
 *
 * Both imports are `import type`, so nothing from `src/server` survives into
 * the browser bundle — the declarations are erased at compile time and the
 * runtime graph is unchanged. What they buy is that the page and the route it
 * calls cannot drift apart silently: renaming a field in `toPublicEvent`, or
 * adding a case to `RegisterResponse.status`, breaks the type-check here
 * instead of producing an `undefined` on a rendered page.
 */
export type { PublicEvent, RegisterResponse };

/** `GET` — one published event by slug. 404 for anything else. */
export function eventDetailEndpoint(slug: string): string {
  return `/api/v1/events/${encodeURIComponent(slug)}`;
}

/**
 * `GET` — the public browse listing, one page at a time.
 *
 * `cursor` names the position after the last event of the previous page, so a
 * passed cursor fetches the *next* page. Omit it for the first page.
 */
export function eventsEndpoint(cursor?: string): string {
  const base = '/api/v1/events';
  return cursor === undefined
    ? base
    : `${base}?cursor=${encodeURIComponent(cursor)}`;
}

/** `POST` — the free registration path for one event. */
export function registerEndpoint(eventId: string): string {
  return `/api/v1/registration/${encodeURIComponent(eventId)}/register`;
}

/** What `GET /api/v1/events/:slug` answers with. */
export interface EventDetailResponse {
  event: PublicEvent;
}

/** What `GET /api/v1/events` answers with. */
export interface EventsListResponse {
  events: PublicEvent[];
  /** Pass back to `eventsEndpoint()` for the next page; `null` on the last. */
  nextCursor: string | null;
}

/**
 * Reading a failed request, whichever shape it arrives in.
 *
 * ## Why `instanceof HttpErrorResponse` is not enough
 *
 * The same `HttpClient` call fails as two different classes depending on where
 * it runs. In the browser, and under `nx serve`, it is an `HttpErrorResponse`.
 * In a production SSR render it is not: Analog's `requestContextInterceptor`
 * detects Nitro's `$fetch` and routes the request in-process — no socket, no
 * HTTP — and a non-2xx answer there rejects with an ofetch `FetchError`, which
 * carries `statusCode` and the parsed body on `data`.
 *
 * An `instanceof` check therefore passes every test and every local run, and
 * then silently fails in production: `/events/:slug` for an unknown slug
 * rendered "Something went wrong" instead of "we couldn't find that workshop",
 * because the 404 was unrecognisable. Reading the fields structurally covers
 * both, and costs nothing.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The HTTP status a failure carries, or `null` when it carries none.
 *
 * A transport failure — DNS, a dropped connection — is `status: 0` on an
 * `HttpErrorResponse`, and is reported as `null` here: the server said nothing,
 * so there is no status to reason about.
 */
export function apiErrorStatus(error: unknown): number | null {
  const failure = asRecord(error);

  if (failure === null) {
    return null;
  }

  const direct = failure['status'] ?? failure['statusCode'];

  if (typeof direct === 'number' && direct > 0) {
    return direct;
  }

  const nested = asRecord(failure['response'])?.['status'];

  return typeof nested === 'number' && nested > 0 ? nested : null;
}

/**
 * The `error` code an API failure carries, when it carries one.
 *
 * Every route on this app answers a failure with `data.error` — a stable
 * machine-readable code — alongside the human `message`. The code is what the
 * UI branches on; the message is written for a developer reading a log, not
 * for the guest, so it is never rendered.
 *
 * The body hangs off `error` on an `HttpErrorResponse` and off `data` on a
 * `FetchError`; both are checked. `data.error` is read before `error`, because
 * the h3 envelope also carries a top-level `error: true` flag that would
 * otherwise shadow the code.
 */
export function apiErrorCode(error: unknown): string | null {
  const failure = asRecord(error);

  if (failure === null) {
    return null;
  }

  for (const body of [asRecord(failure['error']), asRecord(failure['data'])]) {
    if (body === null) {
      continue;
    }

    const code = asRecord(body['data'])?.['error'] ?? body['error'];

    if (typeof code === 'string') {
      return code;
    }
  }

  return null;
}
