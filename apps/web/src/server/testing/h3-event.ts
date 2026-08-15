import { createEvent, type H3Event } from 'h3';

/**
 * A real `H3Event` over fake node request/response objects.
 *
 * The handlers under test read cookies and a JSON body and write `Set-Cookie`,
 * all through h3's own helpers, so the event has to be a genuine one — a
 * hand-rolled stub would test the stub. h3 v1 only touches `headers` and
 * `method` on the request and `get/set/removeHeader` on the response, which is
 * exactly what these two objects provide.
 */

export interface TestEventInit {
  method?: string;
  url?: string;
  /** Parsed by `readBody`: h3 accepts a plain object on `req.body`. */
  body?: unknown;
  /** Sent as a `Cookie:` header, so `getCookie` reads them for real. */
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  /**
   * Route params, as the file-based router would have matched them — the `slug`
   * in `events/[slug].get.ts`. Written to `event.context.params`, which is
   * where `getRouterParam` reads from, so the handler uses the real helper.
   */
  params?: Record<string, string>;
}

export interface TestEvent {
  event: H3Event;
  /** Every `Set-Cookie` the handler wrote, in order. */
  setCookies(): string[];
}

export function createTestEvent(init: TestEventInit = {}): TestEvent {
  const headers: Record<string, string> = { ...init.headers };

  if (init.cookies !== undefined) {
    headers['cookie'] = Object.entries(init.cookies)
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ');
  }

  const req = {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers,
    body: init.body,
  };

  const responseHeaders = new Map<string, string | string[]>();
  const res = {
    setHeader: (name: string, value: string | string[]) => {
      responseHeaders.set(name.toLowerCase(), value);
    },
    getHeader: (name: string) => responseHeaders.get(name.toLowerCase()),
    removeHeader: (name: string) => {
      responseHeaders.delete(name.toLowerCase());
    },
  };

  const event = createEvent(req as never, res as never);

  if (init.params !== undefined) {
    event.context.params = init.params;
  }

  return {
    event,
    setCookies: () => {
      const header = responseHeaders.get('set-cookie');

      if (header === undefined) {
        return [];
      }

      return Array.isArray(header) ? header : [header];
    },
  };
}
