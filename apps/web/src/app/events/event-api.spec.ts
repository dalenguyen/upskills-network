import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import {
  apiErrorCode,
  apiErrorStatus,
  eventDetailEndpoint,
  eventsEndpoint,
} from './event-api';

/**
 * The two shapes one failed request can take.
 *
 * `httpError` is what the browser (and `nx serve`) produce. `fetchError` is
 * what a production SSR render produces, where Analog routes the request
 * through Nitro's in-process `$fetch` and ofetch rejects with its own error
 * class. Both must read the same.
 */
function httpError(status: number, code?: string) {
  return new HttpErrorResponse({
    status,
    statusText: 'Not Found',
    url: '/api/v1/events/x',
    error:
      code === undefined
        ? null
        : {
            error: true,
            statusCode: status,
            message: 'No such event.',
            data: { error: code },
          },
  });
}

function fetchError(status: number, code?: string) {
  // Shaped like ofetch's FetchError: `statusCode`, the parsed body on `data`,
  // and the raw response alongside it.
  return Object.assign(new Error(`[GET] "/api/v1/events/x": ${status}`), {
    statusCode: status,
    status,
    data:
      code === undefined
        ? undefined
        : {
            error: true,
            statusCode: status,
            message: 'No such event.',
            data: { error: code },
          },
    response: { status },
  });
}

describe('apiErrorStatus', () => {
  it('reads the status off an HttpErrorResponse', () => {
    expect(apiErrorStatus(httpError(404))).toBe(404);
  });

  it('reads the status off an ofetch FetchError — the production SSR shape', () => {
    expect(apiErrorStatus(fetchError(404))).toBe(404);
  });

  it('falls back to the nested response status', () => {
    expect(apiErrorStatus({ response: { status: 409 } })).toBe(409);
  });

  it('reports no status for a transport failure', () => {
    // `status: 0` is HttpClient's "the request never reached a server".
    expect(apiErrorStatus(httpError(0))).toBeNull();
  });

  it('reports no status for something that is not an error object', () => {
    expect(apiErrorStatus('boom')).toBeNull();
    expect(apiErrorStatus(null)).toBeNull();
    expect(apiErrorStatus(undefined)).toBeNull();
  });
});

describe('apiErrorCode', () => {
  it('reads the code out of an HttpErrorResponse body', () => {
    expect(apiErrorCode(httpError(409, 'event-cancelled'))).toBe(
      'event-cancelled',
    );
  });

  it('reads the code out of a FetchError body', () => {
    expect(apiErrorCode(fetchError(409, 'event-cancelled'))).toBe(
      'event-cancelled',
    );
  });

  it("is not fooled by h3's top-level error flag", () => {
    // The envelope carries `error: true`; the code lives at `data.error`.
    expect(apiErrorCode({ data: { error: true, data: { error: 'x' } } })).toBe(
      'x',
    );
  });

  it('accepts a body that carries the code directly', () => {
    expect(apiErrorCode({ error: { error: 'event-not-found' } })).toBe(
      'event-not-found',
    );
  });

  it('reports no code when the failure carries none', () => {
    expect(apiErrorCode(httpError(500))).toBeNull();
    expect(apiErrorCode('boom')).toBeNull();
  });
});

describe('eventDetailEndpoint', () => {
  it('escapes the slug so a path segment cannot be smuggled in', () => {
    expect(eventDetailEndpoint('acme', '../orgs/secret')).toBe(
      '/api/v1/orgs/acme/events/..%2Forgs%2Fsecret',
    );
  });

  it('escapes the organizer segment too', () => {
    expect(eventDetailEndpoint('../../admin', 'react-basics')).toBe(
      '/api/v1/orgs/..%2F..%2Fadmin/events/react-basics',
    );
  });
});

describe('eventsEndpoint', () => {
  it('asks for the first page when no cursor is given', () => {
    expect(eventsEndpoint()).toBe('/api/v1/events');
  });

  it('encodes the cursor into the query string', () => {
    expect(eventsEndpoint('a/b?c=d')).toBe(
      '/api/v1/events?cursor=a%2Fb%3Fc%3Dd',
    );
  });
});
