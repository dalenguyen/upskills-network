import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { waitlistSubscriberRef, waitlistSubscribersCol } from './collections';
import { addWaitlistSubscriber } from './waitlist';

/**
 * The write behind a landing-page waitlist signup, against the real emulator.
 * The race lives in `waitlist.concurrency.spec.ts`; everything here is about
 * what one caller at a time is told and what document is left behind.
 */

beforeEach(clearFirestore);

describe('addWaitlistSubscriber', () => {
  it('creates the document keyed by the normalized email', async () => {
    const outcome = await addWaitlistSubscriber('  Ada@Example.COM ');

    expect(outcome).toBe('subscribed');

    const snapshot = await waitlistSubscriberRef('ada@example.com').get();
    const subscriber = snapshot.data();
    expect(subscriber).toMatchObject({ email: 'ada@example.com' });
    expect(subscriber?.createdAt).toBeInstanceOf(Timestamp);
  });

  it('returns already_subscribed for the same email, normalized', async () => {
    const first = await addWaitlistSubscriber('ada@example.com');
    const second = await addWaitlistSubscriber('  ADA@example.com ');

    expect(first).toBe('subscribed');
    expect(second).toBe('already_subscribed');

    const snapshot = await waitlistSubscribersCol().get();
    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0].id).toBe('ada@example.com');
  });

  it('writes nothing at all when the document exists', async () => {
    const originalCreatedAt = Timestamp.fromMillis(0);
    await waitlistSubscriberRef('ada@example.com').set({
      email: 'ada@example.com',
      createdAt: originalCreatedAt,
    });

    const outcome = await addWaitlistSubscriber('ada@example.com');

    expect(outcome).toBe('already_subscribed');
    expect(
      (await waitlistSubscriberRef('ada@example.com').get()).data(),
    ).toEqual({ email: 'ada@example.com', createdAt: originalCreatedAt });
  });

  it('is a no-op when called twice in a row', async () => {
    const first = await addWaitlistSubscriber('ada@example.com');
    const second = await addWaitlistSubscriber('ada@example.com');

    expect(first).toBe('subscribed');
    expect(second).toBe('already_subscribed');
    expect((await waitlistSubscribersCol().get()).docs).toHaveLength(1);
  });
});
