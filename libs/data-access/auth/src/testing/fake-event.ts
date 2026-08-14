import type { IncomingMessage, ServerResponse } from 'node:http';
import { createEvent, type H3Event } from 'h3';

/**
 * An `H3Event` carrying the cookies a test wants to send.
 *
 * Built with h3's own `createEvent` rather than an object literal cast to
 * `H3Event`. The guards read the cookie through `getCookie`, which goes through
 * h3's header handling and cookie parsing — a hand-rolled stand-in would let a
 * test pass while the real parse (quoting, multiple cookies on one header,
 * name matching) did something else. Only the node request and response are
 * faked, and only as far as h3 reaches into them.
 *
 * h3 is pinned to v1 in this workspace; `createEvent` is a v1 API that v2
 * removed, so this file is also what would fail loudly on an accidental v2
 * upgrade rather than failing subtly at runtime in a route.
 */
export function fakeEvent(cookies: Record<string, string> = {}): H3Event {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const req = {
    method: 'POST',
    url: '/api/test',
    headers: header === '' ? {} : { cookie: header },
  } as unknown as IncomingMessage;

  const res = {
    // h3 touches these when a handler responds; the guards never do, and a
    // test that reaches them should fail loudly rather than silently no-op.
    setHeader: () => {
      throw new Error('fakeEvent does not implement a response.');
    },
    getHeader: () => undefined,
  } as unknown as ServerResponse;

  return createEvent(req, res);
}
