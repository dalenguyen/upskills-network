import type { ReserveSpotResult } from '@upskills/firestore';
import type { Guest } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { fakeTimestamp } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeEvent } from '../../testing/public-fixtures';
import { createRegisterHandler, type RegisterDeps } from './register';

/**
 * `POST /api/v1/registration/:eventId/register` — the free path.
 *
 * This is the app's one unauthenticated write, so most of what follows is about
 * what it refuses and what it does *not* say while refusing.
 */

function guest(overrides: Partial<Guest> = {}): Guest {
  return {
    guestId: 'ada@example.com',
    eventId: 'evt-1',
    orgId: 'org-1',
    email: 'ada@example.com',
    name: 'Ada',
    status: 'confirmed',
    registeredAt: fakeTimestamp(FIXTURE_START),
    confirmedAt: fakeTimestamp(FIXTURE_START),
    cancelToken: 'tok_secret_value',
    ...overrides,
  };
}

function reserved(
  overrides: Partial<ReserveSpotResult> = {},
): ReserveSpotResult {
  return {
    outcome: 'confirmed',
    alreadyRegistered: false,
    guest: guest(),
    ...overrides,
  };
}

/** An error shaped exactly as the firestore lib's, which is matched by name. */
function reserveError(name: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`${name} raised`), { name, ...extra });
}

function deps(overrides: Partial<RegisterDeps> = {}): RegisterDeps {
  return {
    getEvent: vi.fn(async () => fakeEvent({ price: 0 })),
    reserveSpot: vi.fn(async () => reserved()),
    sendWelcomeEmail: vi.fn(async () => ({ sent: true as const, id: 'em_1' })),
    sendWaitlistEmail: vi.fn(async () => ({ sent: true as const, id: 'em_2' })),
    ...overrides,
  };
}

function post(body: unknown, eventId = 'evt-1') {
  return createTestEvent({
    method: 'POST',
    url: `/api/v1/registration/${eventId}/register`,
    params: { eventId },
    body,
  }).event;
}

const VALID = { email: 'Ada@Example.com', name: 'Ada' };

describe('POST /api/v1/registration/:eventId/register', () => {
  describe('under capacity', () => {
    it('confirms the guest and sends the welcome email', async () => {
      const sendWelcomeEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_1',
      }));

      const result = await createRegisterHandler(deps({ sendWelcomeEmail }))(
        post(VALID),
      );

      expect(result).toEqual({
        status: 'confirmed',
        alreadyRegistered: false,
        emailSent: true,
      });
      expect(sendWelcomeEmail).toHaveBeenCalledOnce();
    });

    it('reserves against the event named in the path', async () => {
      const reserveSpot = vi.fn(async () => reserved());

      await createRegisterHandler(deps({ reserveSpot }))(
        post(VALID, 'evt-other'),
      );

      // The email arrives normalized: `EmailSchema` lowercases and trims on
      // parse, so the guest doc id is settled before the transaction opens and
      // "Ada@Example.com" cannot register a second time as "ada@example.com".
      expect(reserveSpot).toHaveBeenCalledWith('evt-other', {
        email: 'ada@example.com',
        name: 'Ada',
      });
    });

    it('never returns the cancel token', async () => {
      // The token is the only thing standing between a stranger and cancelling
      // this registration. It travels by email and nowhere else.
      const result = await createRegisterHandler(deps())(post(VALID));

      expect(JSON.stringify(result)).not.toContain('tok_secret_value');
    });
  });

  describe('at capacity', () => {
    const waitlisted = reserved({
      outcome: 'waitlisted',
      guest: guest({ status: 'pending', waitlistPosition: 4 }),
    });

    it('waitlists the guest and reports the position', async () => {
      const result = await createRegisterHandler(
        deps({ reserveSpot: vi.fn(async () => waitlisted) }),
      )(post(VALID));

      expect(result).toEqual({
        status: 'waitlisted',
        alreadyRegistered: false,
        waitlistPosition: 4,
        emailSent: true,
      });
    });

    it('sends the waitlist email with that position, not the welcome one', async () => {
      const sendWaitlistEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_2',
      }));
      const sendWelcomeEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_1',
      }));

      await createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () => waitlisted),
          sendWaitlistEmail,
          sendWelcomeEmail,
        }),
      )(post(VALID));

      expect(sendWaitlistEmail).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
        expect.objectContaining({ eventId: 'evt-1' }),
        4,
      );
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });
  });

  describe('registering twice', () => {
    it('answers 200 with the standing registration', async () => {
      const result = await createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () =>
            reserved({ alreadyRegistered: true }),
          ),
        }),
      )(post(VALID));

      expect(result).toMatchObject({
        status: 'confirmed',
        alreadyRegistered: true,
      });
    });

    it('sends no second email', async () => {
      const sendWelcomeEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_1',
      }));

      await createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () =>
            reserved({ alreadyRegistered: true }),
          ),
          sendWelcomeEmail,
        }),
      )(post(VALID));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('still reports emailSent, because the original mail is in their inbox', async () => {
      const result = await createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () =>
            reserved({ alreadyRegistered: true }),
          ),
        }),
      )(post(VALID));

      expect(result).toMatchObject({ emailSent: true });
    });
  });

  describe('email failure', () => {
    it('keeps the registration and reports emailSent: false', async () => {
      // The seat is already committed. Failing the request would tell the guest
      // they are not registered when they are.
      const result = await createRegisterHandler(
        deps({
          sendWelcomeEmail: vi.fn(async () => ({
            sent: false as const,
            reason: 'unavailable' as const,
            detail: 'socket hang up',
          })),
        }),
      )(post(VALID));

      expect(result).toEqual({
        status: 'confirmed',
        alreadyRegistered: false,
        emailSent: false,
      });
    });
  });

  describe('events that cannot be registered for', () => {
    it('answers 404 for an event that does not exist', async () => {
      await expect(
        createRegisterHandler(deps({ getEvent: vi.fn(async () => null) }))(
          post(VALID),
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        data: { error: 'event-not-found' },
      });
    });

    it('answers 404 for a draft event, identically to a missing one', async () => {
      const missing = await createRegisterHandler(
        deps({ getEvent: vi.fn(async () => null) }),
      )(post(VALID)).catch((error: unknown) => error);

      const draft = await createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () => {
            throw reserveError('EventNotRegisterableError', {
              status: 'draft',
            });
          }),
        }),
      )(post(VALID)).catch((error: unknown) => error);

      // A draft slug is guessable. Anything that distinguishes the two answers
      // confirms an unannounced event to whoever guessed it.
      expect({
        statusCode: (draft as { statusCode: number }).statusCode,
        message: (draft as { message: string }).message,
        data: (draft as { data: unknown }).data,
      }).toEqual({
        statusCode: (missing as { statusCode: number }).statusCode,
        message: (missing as { message: string }).message,
        data: (missing as { data: unknown }).data,
      });
    });

    it('answers 409 for a cancelled event, and says so', async () => {
      // The caller could already see this event — they may have a stale tab
      // open. Hiding it buys nothing and explains nothing.
      await expect(
        createRegisterHandler(
          deps({
            reserveSpot: vi.fn(async () => {
              throw reserveError('EventNotRegisterableError', {
                status: 'cancelled',
              });
            }),
          }),
        )(post(VALID)),
      ).rejects.toMatchObject({
        statusCode: 409,
        data: { error: 'event-cancelled' },
      });
    });

    it('answers 404 when the event vanishes between the read and the transaction', async () => {
      await expect(
        createRegisterHandler(
          deps({
            reserveSpot: vi.fn(async () => {
              throw reserveError('EventNotFoundError');
            }),
          }),
        )(post(VALID)),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses a paid event rather than confirming a free seat on it', async () => {
      const reserveSpot = vi.fn(async () => reserved());

      await expect(
        createRegisterHandler(
          deps({
            getEvent: vi.fn(async () => fakeEvent({ price: 2500 })),
            reserveSpot,
          }),
        )(post(VALID)),
      ).rejects.toMatchObject({
        statusCode: 409,
        data: { error: 'payment-required' },
      });
      expect(reserveSpot).not.toHaveBeenCalled();
    });
  });

  describe('bad input', () => {
    it.each([
      ['a missing body', undefined],
      ['a missing email', { name: 'Ada' }],
      ['a malformed email', { email: 'not-an-email', name: 'Ada' }],
      ['a missing name', { email: 'ada@example.com' }],
      ['a blank name', { email: 'ada@example.com', name: '   ' }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(
        createRegisterHandler(deps())(post(body)),
      ).rejects.toMatchObject({
        statusCode: 400,
        data: { error: 'invalid-registration' },
      });
    });

    it('validates before reading the event', async () => {
      const getEvent = vi.fn(async () => fakeEvent());

      await expect(
        createRegisterHandler(deps({ getEvent }))(post({ email: 'nope' })),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(getEvent).not.toHaveBeenCalled();
    });

    it('answers 404 when the router matched no event id', async () => {
      const event = createTestEvent({
        method: 'POST',
        url: '/api/v1/registration//register',
        body: VALID,
      }).event;

      await expect(
        createRegisterHandler(deps())(event),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  it('lets an unexpected reservation failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createRegisterHandler(
        deps({
          reserveSpot: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(post(VALID)),
    ).rejects.toBe(bug);
  });
});
