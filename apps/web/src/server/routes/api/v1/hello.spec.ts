import { createEvent, defineEventHandler } from 'h3';
import { describe, expect, it } from 'vitest';

import helloHandler from './hello';

// Guards the h3 v1.15 pin: `createEvent` only exists in h3 v1, so this spec
// fails at import time if the lockfile or the vite alias ever drifts to v2.
describe('h3 resolution', () => {
  it('exposes the v1 createEvent API', () => {
    expect(typeof createEvent).toBe('function');
    expect(typeof defineEventHandler).toBe('function');
  });
});

describe('GET /api/v1/hello', () => {
  it('returns the greeting', async () => {
    const req = { method: 'GET', url: '/api/v1/hello', headers: {} };
    const res = { setHeader: () => undefined, getHeader: () => undefined };
    const event = createEvent(req as never, res as never);

    await expect(helloHandler(event)).toEqual({ message: 'Hello World' });
  });
});
