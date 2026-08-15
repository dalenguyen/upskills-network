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

/** `POST` — the free registration path for one event. */
export function registerEndpoint(eventId: string): string {
  return `/api/v1/registration/${encodeURIComponent(eventId)}/register`;
}

/** What `GET /api/v1/events/:slug` answers with. */
export interface EventDetailResponse {
  event: PublicEvent;
}

/**
 * The `error` code an API failure carries, when it carries one.
 *
 * Every route on this app answers a failure with `data.error` — a stable
 * machine-readable code — alongside the human `message`. The code is what the
 * UI branches on; the message is written for a developer reading a log, not
 * for the guest, so it is never rendered.
 */
export function apiErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') {
    return null;
  }

  const body = (error as { error?: { data?: unknown } }).error;
  const data = (body as { data?: unknown })?.data ?? body;
  const code = (data as { error?: unknown })?.error;

  return typeof code === 'string' ? code : null;
}
