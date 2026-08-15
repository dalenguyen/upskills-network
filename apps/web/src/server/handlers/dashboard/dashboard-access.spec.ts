import { describe, expect, it } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { eventForbidden, readOrgId } from './dashboard-access';

/** The shared `?orgId=` contract and the shared missing-event 403. */

describe('readOrgId', () => {
  it('reads a non-empty ?orgId=', () => {
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/dashboard/events?orgId=org-1',
    }).event;

    expect(readOrgId(event)).toBe('org-1');
  });

  it('trims surrounding whitespace', () => {
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/dashboard/events?orgId=%20%20org-1%20%20',
    }).event;

    expect(readOrgId(event)).toBe('org-1');
  });

  it('answers 400 when ?orgId= is missing', async () => {
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/dashboard/events',
    }).event;

    await expect(
      Promise.resolve().then(() => readOrgId(event)),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-org-id' },
    });
  });

  it('answers 400 when ?orgId= is blank', async () => {
    const event = createTestEvent({
      method: 'GET',
      url: '/api/v1/dashboard/events?orgId=',
    }).event;

    await expect(
      Promise.resolve().then(() => readOrgId(event)),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-org-id' },
    });
  });
});

describe('eventForbidden', () => {
  it('is the shared 403 for a missing event', () => {
    const forbidden = eventForbidden();

    expect(forbidden).toMatchObject({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: { error: 'forbidden' },
    });
    expect((forbidden as Error).message).toBe(
      'You do not have access to this resource.',
    );
  });
});
