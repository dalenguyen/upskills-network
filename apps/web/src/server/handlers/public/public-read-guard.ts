import {
  createError,
  defineEventHandler,
  getQuery,
  getRequestHeader,
  setResponseHeader,
  type EventHandler,
  type H3Event,
} from 'h3';
import type { ApiErrorData } from '../http-error';

/**
 * A per-instance cache and rate limit for the unauthenticated listing routes.
 *
 * ## Why
 *
 * `GET /api/v1/events` and `GET /api/v1/orgs/:orgSlug` need no sign-in, and
 * every call is a Firestore range read plus an org-slug lookup. The browse page
 * makes two per render (upcoming and past). Nothing stopped a script from
 * turning that into a Firestore bill.
 *
 * ## Two layers, because each one alone has a hole
 *
 * - **Cache.** Identical requests inside `ttlMs` share one read, and requests
 *   in flight at the same time share one promise. Every render of `/events`
 *   asks the same two questions, so page traffic costs a few reads a minute
 *   whatever the volume. But a caller can mint a new cache key per request by
 *   forging cursors.
 * - **Rate limit.** Caps each client IP, which covers the forged-cursor case.
 *   A request with no IP (a server-side render calling the API in-process) is
 *   not limited: grouping every such request under one key would throttle
 *   all visitors together, and the cache already covers them.
 *
 * Both live in instance memory. Cloud Run may run several instances, so the
 * real ceiling is the limit times the instance count. That is enough to turn
 * "unbounded" into "bounded". A shared store (Redis, Cloud Armor) is the next
 * step if the numbers ever say it is needed.
 *
 * ## Staleness
 *
 * A listing can be up to `ttlMs` old: a newly published event, or a new seat
 * count, can take that long to appear. The event detail page is not cached,
 * so a guest about to register always sees the live state.
 */

/** Requests per client IP per window, across all guarded routes. */
export const PUBLIC_READ_LIMIT = 60;
export const PUBLIC_READ_WINDOW_MS = 60_000;
/** How long a listing response is reused. */
export const PUBLIC_READ_TTL_MS = 60_000;

type Clock = () => number;

/**
 * The caller's IP, or `null` when the request did not come over the network.
 *
 * The service is reached through a Cloud Run domain mapping, where Google's
 * front end *appends* the connecting address to `X-Forwarded-For`. The last
 * entry is therefore the one Google wrote. Earlier entries came from the
 * client and can say anything, which is why h3's `getRequestIP` (it takes the
 * first) is not used. Behind a load balancer this would be the second-to-last.
 */
export function clientIp(event: H3Event): string | null {
  const forwarded = getRequestHeader(event, 'x-forwarded-for');
  const last = forwarded?.split(',').pop()?.trim();

  if (last) {
    return last;
  }

  return event.node.req.socket?.remoteAddress ?? null;
}

export interface RateLimiter {
  /** Count one request for `key`. `retryAfterSec` is set when it is refused. */
  take(key: string): { allowed: boolean; retryAfterSec: number };
}

/**
 * A fixed-window counter per key.
 *
 * Fixed rather than sliding: a burst at a window edge can reach twice the
 * limit, which does not matter at this scale, and the whole state is one
 * number per key. At most `maxKeys` are held; when full, expired windows are
 * pruned, then the oldest keys are dropped. A dropped key starts again at
 * zero, so under a flood of distinct IPs the limit gets looser, never tighter.
 */
export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: Clock;
}): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  function prune(at: number): void {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= windowMs) {
        windows.delete(key);
      }
    }

    // Map iterates in insertion order, so this drops the oldest first.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) {
        break;
      }
      windows.delete(key);
    }
  }

  return {
    take(key) {
      const at = now();
      let window = windows.get(key);

      if (!window || at - window.startedAt >= windowMs) {
        windows.delete(key);
        if (windows.size >= maxKeys) {
          prune(at);
        }
        window = { startedAt: at, count: 0 };
        windows.set(key, window);
      }

      window.count += 1;

      if (window.count <= limit) {
        return { allowed: true, retryAfterSec: 0 };
      }

      return {
        allowed: false,
        retryAfterSec: Math.ceil((window.startedAt + windowMs - at) / 1000),
      };
    },
  };
}

export interface ResponseCache {
  /** The cached value for `key`, or the result of `load`, stored for reuse. */
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
}

/**
 * A TTL cache of promises, so concurrent misses on one key share one load.
 *
 * A load that rejects is removed at once: a 400 for a bad cursor, or a
 * Firestore blip, must not be served to the next caller for a minute. At most
 * `maxEntries` are held, dropping the oldest.
 */
export function createResponseCache({
  ttlMs,
  maxEntries = 500,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: Clock;
}): ResponseCache {
  const entries = new Map<string, { expiresAt: number; value: unknown }>();

  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const at = now();
      const hit = entries.get(key);

      if (hit && hit.expiresAt > at) {
        return hit.value as Promise<T>;
      }

      entries.delete(key);
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }

      const value = load();
      const entry = { expiresAt: at + ttlMs, value };
      entries.set(key, entry);

      value.catch(() => {
        // Only remove our own entry: a later call may already have replaced it.
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      });

      return value;
    },
  };
}

function tooManyRequests() {
  return createError({
    statusCode: 429,
    statusMessage: 'Too Many Requests',
    message: 'Too many requests. Try again in a minute.',
    data: { error: 'rate-limited' } satisfies ApiErrorData,
  });
}

/**
 * Wrap a public read handler in the rate limit and the cache.
 *
 * `keyOf` names what makes two requests the same. It must be built from the
 * parameters the handler reads, not from the raw URL: otherwise `?x=1`, `?x=2`
 * and so on would each be a new key and skip the cache.
 */
export function guardPublicRead(
  handler: EventHandler,
  {
    limiter,
    cache,
    keyOf,
  }: {
    limiter: RateLimiter;
    cache: ResponseCache;
    keyOf: (event: H3Event) => string;
  },
): EventHandler {
  return defineEventHandler(async (event) => {
    const ip = clientIp(event);

    if (ip !== null) {
      const { allowed, retryAfterSec } = limiter.take(ip);

      if (!allowed) {
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw tooManyRequests();
      }
    }

    return cache.get(keyOf(event), async () => handler(event));
  });
}

/** One limiter for every guarded route, so the cap is per client, not per route. */
export const publicReadLimiter = createRateLimiter({
  limit: PUBLIC_READ_LIMIT,
  windowMs: PUBLIC_READ_WINDOW_MS,
});

/** The listing parameters every guarded route reads, as one cache key part. */
export function listingKey(event: H3Event): string {
  const query = getQuery(event);
  const part = (name: string) =>
    typeof query[name] === 'string' ? query[name] : '';

  return [part('when'), part('cursor'), part('limit')].join('|');
}
