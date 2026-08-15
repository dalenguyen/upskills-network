import type { TransitionResult } from '@upskills/firestore';
import type { Guest } from '@upskills/models';
import { describe, expect, it, vi } from 'vitest';
import { fakeTimestamp } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import { FIXTURE_START, fakeEvent } from '../../testing/public-fixtures';
import { createCancelHandler, type CancelDeps } from './cancel';

/**
 * `POST /api/v1/registration/:eventId/cancel`.
 *
 * The token comparison is the only authorization in the app that is not a
 * session, so most of these tests are about what a caller can learn by getting
 * it wrong.
 */

const TOKEN = 'tok_the_real_cancel_token_value';

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
    cancelToken: TOKEN,
    ...overrides,
  };
}

function cancelled(
  overrides: Partial<TransitionResult> = {},
): TransitionResult {
  return {
    changed: true,
    guest: guest({ status: 'cancelled' }),
    ...overrides,
  };
}

function deps(overrides: Partial<CancelDeps> = {}): CancelDeps {
  return {
    getGuest: vi.fn(async () => guest()),
    getEvent: vi.fn(async () => fakeEvent()),
    cancelGuest: vi.fn(async () => cancelled()),
    promoteNextPending: vi.fn(async () => null),
    sendCancellationEmail: vi.fn(async () => ({
      sent: true as const,
      id: 'em_1',
    })),
    sendSpotOpenedEmail: vi.fn(async () => ({
      sent: true as const,
      id: 'em_2',
    })),
    ...overrides,
  };
}

function post(body: unknown, eventId = 'evt-1') {
  return createTestEvent({
    method: 'POST',
    url: `/api/v1/registration/${eventId}/cancel`,
    params: { eventId },
    body,
  }).event;
}

const VALID = { email: 'ada@example.com', cancelToken: TOKEN };

describe('POST /api/v1/registration/:eventId/cancel', () => {
  describe('with the right token', () => {
    it('cancels the registration and confirms by email', async () => {
      const sendCancellationEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_1',
      }));

      const result = await createCancelHandler(deps({ sendCancellationEmail }))(
        post(VALID),
      );

      expect(result).toEqual({
        cancelled: true,
        alreadyCancelled: false,
        promoted: false,
        emailSent: true,
      });
      expect(sendCancellationEmail).toHaveBeenCalledOnce();
    });

    it('cancels the guest named in the body, on the event named in the path', async () => {
      const cancelGuest = vi.fn(async () => cancelled());

      await createCancelHandler(deps({ cancelGuest }))(
        post(VALID, 'evt-other'),
      );

      expect(cancelGuest).toHaveBeenCalledWith('evt-other', 'ada@example.com');
    });

    it('promotes the next waitlisted guest and tells them', async () => {
      const promotedGuest = guest({
        guestId: 'bob@example.com',
        email: 'bob@example.com',
        name: 'Bob',
      });
      const sendSpotOpenedEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_2',
      }));

      const result = await createCancelHandler(
        deps({
          promoteNextPending: vi.fn(async () => promotedGuest),
          sendSpotOpenedEmail,
        }),
      )(post(VALID));

      expect(result).toMatchObject({ promoted: true });
      expect(sendSpotOpenedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'bob@example.com' }),
        expect.objectContaining({ eventId: 'evt-1' }),
      );
    });

    it('reports promoted: false when the waitlist is empty', async () => {
      const result = await createCancelHandler(
        deps({ promoteNextPending: vi.fn(async () => null) }),
      )(post(VALID));

      expect(result).toMatchObject({ promoted: false });
    });

    it('leaves the cancellation standing when the confirmation email fails', async () => {
      const result = await createCancelHandler(
        deps({
          sendCancellationEmail: vi.fn(async () => ({
            sent: false as const,
            reason: 'unavailable' as const,
            detail: 'socket hang up',
          })),
        }),
      )(post(VALID));

      expect(result).toMatchObject({ cancelled: true, emailSent: false });
    });
  });

  describe('cancelling twice', () => {
    const already = cancelled({
      changed: false,
      guest: guest({ status: 'cancelled' }),
    });

    it('is a no-op that still answers 2xx', async () => {
      const result = await createCancelHandler(
        deps({ cancelGuest: vi.fn(async () => already) }),
      )(post(VALID));

      expect(result).toMatchObject({
        cancelled: true,
        alreadyCancelled: true,
      });
    });

    it('sends no second confirmation', async () => {
      const sendCancellationEmail = vi.fn(async () => ({
        sent: true as const,
        id: 'em_1',
      }));

      await createCancelHandler(
        deps({
          cancelGuest: vi.fn(async () => already),
          sendCancellationEmail,
        }),
      )(post(VALID));

      expect(sendCancellationEmail).not.toHaveBeenCalled();
    });

    it('still attempts promotion, so a lost one can be repaired', async () => {
      // A promotion that never ran because the first request crashed after the
      // cancel committed is otherwise stuck forever.
      const promoteNextPending = vi.fn(async () => null);

      await createCancelHandler(
        deps({ cancelGuest: vi.fn(async () => already), promoteNextPending }),
      )(post(VALID));

      expect(promoteNextPending).toHaveBeenCalledWith('evt-1');
    });
  });

  describe('refusing', () => {
    /** Every refusal must be indistinguishable from every other refusal. */
    async function refusal(
      overrides: Partial<CancelDeps>,
      body: unknown = VALID,
    ) {
      return createCancelHandler(deps(overrides))(post(body)).catch(
        (error: unknown) => error as Record<string, unknown>,
      );
    }

    it('answers 403 for a wrong token', async () => {
      const error = await refusal({
        getGuest: vi.fn(async () => guest({ cancelToken: 'tok_other' })),
      });

      expect(error).toMatchObject({
        statusCode: 403,
        data: { error: 'cancel-refused' },
      });
    });

    it('answers 403 for an email that never registered', async () => {
      const error = await refusal({ getGuest: vi.fn(async () => null) });

      expect(error).toMatchObject({ statusCode: 403 });
    });

    it('answers identically whether or not the registration exists', async () => {
      const wrongToken = await refusal({
        getGuest: vi.fn(async () => guest({ cancelToken: 'tok_other' })),
      });
      const noSuchGuest = await refusal({ getGuest: vi.fn(async () => null) });

      // Any difference here — status, code, wording — turns the endpoint into a
      // membership oracle: submit an address with a junk token and read off
      // whether that person is attending.
      expect({
        statusCode: noSuchGuest['statusCode'],
        statusMessage: noSuchGuest['statusMessage'],
        message: noSuchGuest['message'],
        data: noSuchGuest['data'],
      }).toEqual({
        statusCode: wrongToken['statusCode'],
        statusMessage: wrongToken['statusMessage'],
        message: wrongToken['message'],
        data: wrongToken['data'],
      });
    });

    it('refuses a token that is a prefix of the real one', async () => {
      const error = await refusal(
        {},
        {
          email: 'ada@example.com',
          cancelToken: TOKEN.slice(0, 10),
        },
      );

      expect(error).toMatchObject({ statusCode: 403 });
    });

    it('refuses a token that only differs in case', async () => {
      const error = await refusal(
        {},
        {
          email: 'ada@example.com',
          cancelToken: TOKEN.toUpperCase(),
        },
      );

      expect(error).toMatchObject({ statusCode: 403 });
    });

    it('cancels nothing when it refuses', async () => {
      const cancelGuest = vi.fn(async () => cancelled());
      const promoteNextPending = vi.fn(async () => null);

      await refusal({
        getGuest: vi.fn(async () => null),
        cancelGuest,
        promoteNextPending,
      });

      expect(cancelGuest).not.toHaveBeenCalled();
      expect(promoteNextPending).not.toHaveBeenCalled();
    });

    it('does not read the event before refusing', async () => {
      const getEvent = vi.fn(async () => fakeEvent());

      await refusal({ getGuest: vi.fn(async () => null), getEvent });

      expect(getEvent).not.toHaveBeenCalled();
    });
  });

  describe('bad input', () => {
    it.each([
      ['a missing body', undefined],
      ['a missing token', { email: 'ada@example.com' }],
      ['an empty token', { email: 'ada@example.com', cancelToken: '' }],
      ['a missing email', { cancelToken: TOKEN }],
      ['a malformed email', { email: 'nope', cancelToken: TOKEN }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(
        createCancelHandler(deps())(post(body)),
      ).rejects.toMatchObject({
        statusCode: 400,
        data: { error: 'invalid-cancellation' },
      });
    });

    it('answers 404 when the guest exists but the event does not', async () => {
      // Broken data, not a caller error — so it does not get the 403 that
      // hides everything else.
      await expect(
        createCancelHandler(deps({ getEvent: vi.fn(async () => null) }))(
          post(VALID),
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        data: { error: 'event-not-found' },
      });
    });
  });

  it('lets an unexpected failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');

    await expect(
      createCancelHandler(
        deps({
          cancelGuest: vi.fn(async () => {
            throw bug;
          }),
        }),
      )(post(VALID)),
    ).rejects.toBe(bug);
  });
});
