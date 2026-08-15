import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import {
  createWaitlistPostHandler,
  type WaitlistPostDeps,
} from './waitlist-post';

/**
 * `POST /api/v1/waitlist`.
 *
 * The dependencies are injected because `@upskills/firestore` cannot be
 * imported at runtime under Vitest (see `src/server/alias-smoke.spec.ts`), and
 * because the route's job is the mapping around them: status codes, the email
 * normalization, and the order of write-then-send.
 */

function deps(overrides: Partial<WaitlistPostDeps> = {}): WaitlistPostDeps {
  return {
    addWaitlistSubscriber: vi.fn(async () => 'subscribed'),
    sendWaitlistConfirmationEmail: vi.fn(async () => ({
      sent: true as const,
      id: 'em_waitlist',
    })),
    ...overrides,
  };
}

function post(body: unknown) {
  return createTestEvent({
    method: 'POST',
    url: '/api/v1/waitlist',
    body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/waitlist', () => {
  it('subscribes a new email and sends the confirmation', async () => {
    const d = deps();
    const { event } = post({ email: ' Ada@Example.COM ' });

    const result = await createWaitlistPostHandler(d)(event);

    expect(result).toEqual({ status: 'subscribed' });
    expect(event.node.res.statusCode).toBe(201);
    expect(d.addWaitlistSubscriber).toHaveBeenCalledWith('ada@example.com');
    expect(d.sendWaitlistConfirmationEmail).toHaveBeenCalledWith(
      'ada@example.com',
    );
  });

  it('answers 200 already_subscribed for a duplicate and sends nothing', async () => {
    const d = deps({
      addWaitlistSubscriber: vi.fn(async () => 'already_subscribed'),
    });
    const { event } = post({ email: 'ada@example.com' });

    const result = await createWaitlistPostHandler(d)(event);

    expect(result).toEqual({ status: 'already_subscribed' });
    expect(d.sendWaitlistConfirmationEmail).not.toHaveBeenCalled();
  });

  it('answers 400 for an email that is not valid', async () => {
    const d = deps();

    await expect(
      createWaitlistPostHandler(d)(post({ email: 'not-an-email' }).event),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-email' },
    });
    expect(d.addWaitlistSubscriber).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not { email }', async () => {
    const d = deps();

    await expect(
      createWaitlistPostHandler(d)(post({ token: 'wrong-field' }).event),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-body' },
    });
    expect(d.addWaitlistSubscriber).not.toHaveBeenCalled();
  });

  it('keeps the subscription and logs when the confirmation cannot be sent', async () => {
    const d = deps({
      sendWaitlistConfirmationEmail: vi.fn(async () => ({
        sent: false as const,
        reason: 'unavailable' as const,
        detail: 'socket hang up',
      })),
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { event } = post({ email: 'ada@example.com' });

    const result = await createWaitlistPostHandler(d)(event);

    expect(result).toEqual({ status: 'subscribed' });
    expect(event.node.res.statusCode).toBe(201);
    expect(consoleError).toHaveBeenCalledWith(
      '[waitlist] confirmation email not sent',
      expect.objectContaining({ sent: false, reason: 'unavailable' }),
    );
  });

  it('lets an unexpected datastore failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      addWaitlistSubscriber: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(
      createWaitlistPostHandler(d)(post({ email: 'ada@example.com' }).event),
    ).rejects.toBe(bug);
  });
});
