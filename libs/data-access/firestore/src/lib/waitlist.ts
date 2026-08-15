import { normalizeEmail } from '@upskills/validation';
import { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';
import { waitlistSubscriberRef } from './collections';
import { runTransaction } from './transactions';

/**
 * The answer a waitlist signup gets.
 *
 * - `subscribed` — this call created the document.
 * - `already_subscribed` — the email already had a document; nothing was
 *   written, so the caller can skip any confirmation email it already sent.
 */
export type WaitlistOutcome = 'subscribed' | 'already_subscribed';

/**
 * Add an email to the landing-page waitlist, once.
 *
 * ## Why create-if-absent is a transaction
 *
 * The obvious shape is a read followed by a write: fetch the document, create
 * it if it is not there. Two simultaneous submissions of the same email both
 * read "no document" and both write one — and on a collection whose document id
 * *is* the normalized email, that is not two different rows, it is two writers
 * fighting over the same key.
 *
 * Reading the *missing* document inside the transaction is the whole mechanism,
 * exactly as in {@link createUserIfAbsent}: the empty key joins the
 * transaction's read set, so a racer that creates it before the commit forces a
 * retry rather than an overwrite, and the retry re-reads and finds their
 * document.
 */
export function addWaitlistSubscriber(
  email: string,
): Promise<WaitlistOutcome> {
  const normalizedEmail = normalizeEmail(email);
  const ref = waitlistSubscriberRef(normalizedEmail);

  // Generated once, outside the transaction: a retried attempt must not rewrite
  // a different `createdAt`, and only the committed document is ever visible.
  const createdAt = FirestoreTimestamp.now();

  return runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (snapshot.data()) {
      return 'already_subscribed';
    }

    // `create`, never `set`: the read set is what serializes concurrent
    // signups, and this is the backstop underneath it. If a document somehow
    // appears between the read and the commit, the write fails rather than
    // overwriting a live subscriber's `createdAt`.
    transaction.create(ref, { email: normalizedEmail, createdAt });

    return 'subscribed';
  });
}
