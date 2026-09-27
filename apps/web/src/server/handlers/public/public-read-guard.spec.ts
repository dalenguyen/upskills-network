import { defineEventHandler, getQuery } from 'h3';
import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import {
  clientIp,
  createRateLimiter,
  createResponseCache,
  guardPublicRead,
  listingKey,
} from './public-read-guard';

/** A clock the test moves by hand. */
function manualClock(start = 0) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

const fromIp = (ip: string, url = '/api/v1/events') =>
  createTestEvent({ url, headers: { 'x-forwarded-for': ip } }).event;

describe('clientIp', () => {
  it('trusts the last X-Forwarded-For entry, the one Google appends', () => {
    // The first entry is whatever the client sent, so it cannot be the key.
    expect(clientIp(fromIp('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
  });

  it('answers null for an in-process request with no address', () => {
    expect(clientIp(createTestEvent().event)).toBeNull();
  });
});

describe('createRateLimiter', () => {
  it('allows the limit, then refuses with the seconds left in the window', () => {
    const clock = manualClock();
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: clock.now,
    });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    clock.advance(20_000);
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSec: 40 });
  });

  it('opens a fresh window once the old one runs out', () => {
    const clock = manualClock();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    limiter.take('a');
    expect(limiter.take('a').allowed).toBe(false);
    clock.advance(60_000);
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('holds at most maxKeys, dropping the oldest', () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 2,
    });

    limiter.take('a');
    limiter.take('b');
    limiter.take('c');

    // `a` was dropped, so it starts again at zero: the limit gets looser under
    // a flood of distinct keys, never tighter.
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('c').allowed).toBe(false);
  });
});

describe('createResponseCache', () => {
  it('reuses a value until the TTL runs out', async () => {
    const clock = manualClock();
    const cache = createResponseCache({ ttlMs: 60_000, now: clock.now });
    const load = vi.fn(async () => 'page');

    await cache.get('k', load);
    clock.advance(59_999);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent misses', async () => {
    const cache = createResponseCache({ ttlMs: 60_000 });
    const load = vi.fn(async () => 'page');

    await Promise.all([cache.get('k', load), cache.get('k', load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure', async () => {
    const cache = createResponseCache({ ttlMs: 60_000 });

    await expect(
      cache.get('k', async () => {
        throw new Error('firestore blip');
      }),
    ).rejects.toThrow('firestore blip');

    await expect(cache.get('k', async () => 'page')).resolves.toBe('page');
  });

  it('holds at most maxEntries, dropping the oldest', async () => {
    const cache = createResponseCache({ ttlMs: 60_000, maxEntries: 1 });
    const load = vi.fn(async () => 'page');

    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('a', load);

    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('listingKey', () => {
  it('ignores parameters the handler does not read', () => {
    // Otherwise `?x=1`, `?x=2`, ... would each skip the cache.
    const plain = createTestEvent({ url: '/api/v1/events?when=past' }).event;
    const padded = createTestEvent({
      url: '/api/v1/events?when=past&x=1',
    }).event;

    expect(listingKey(padded)).toBe(listingKey(plain));
  });

  it('cannot be forged into another query by a separator in the cursor', () => {
    const key = (url: string) => listingKey(createTestEvent({ url }).event);

    expect(key('/api/v1/events?cursor=a%7C5')).not.toBe(
      key('/api/v1/events?cursor=a&limit=5'),
    );
  });

  it('tells timeframes, cursors, and limits apart', () => {
    const keys = [
      '/api/v1/events',
      '/api/v1/events?when=past',
      '/api/v1/events?cursor=abc',
      '/api/v1/events?limit=5',
    ].map((url) => listingKey(createTestEvent({ url }).event));

    expect(new Set(keys).size).toBe(4);
  });
});

describe('guardPublicRead', () => {
  function guarded(limit = 2) {
    const inner = vi.fn(async (event) => ({ when: getQuery(event)['when'] }));
    const handler = guardPublicRead(defineEventHandler(inner), {
      limiter: createRateLimiter({ limit, windowMs: 60_000 }),
      cache: createResponseCache({ ttlMs: 60_000 }),
      keyOf: listingKey,
    });
    return { inner, handler };
  }

  it('answers repeat requests from the cache', async () => {
    const { inner, handler } = guarded();

    await handler(fromIp('203.0.113.1', '/api/v1/events?when=past'));
    const second = await handler(
      fromIp('203.0.113.2', '/api/v1/events?when=past'),
    );

    expect(second).toEqual({ when: 'past' });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('answers 429 with Retry-After once an IP is over the limit', async () => {
    const { handler } = guarded(1);
    await handler(fromIp('203.0.113.1'));

    const event = fromIp('203.0.113.1');
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 429,
      data: { error: 'rate-limited' },
    });
    expect(Number(event.node.res.getHeader('retry-after'))).toBeGreaterThan(0);
  });

  it('counts the limit even when the answer came from the cache', async () => {
    // Otherwise the cache would be a way around the limit, not a second wall.
    const { handler } = guarded(1);
    await handler(fromIp('203.0.113.1'));

    await expect(handler(fromIp('203.0.113.1'))).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('never limits an in-process request with no IP', async () => {
    const { handler } = guarded(1);

    for (let i = 0; i < 5; i++) {
      await expect(
        handler(createTestEvent({ url: '/api/v1/events' }).event),
      ).resolves.toBeDefined();
    }
  });
});
