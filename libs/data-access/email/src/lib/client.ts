import { Resend } from 'resend';
import type { CreateEmailOptions, CreateEmailResponse } from 'resend';
import { resendApiKey } from './config';

/**
 * The one place this library touches the network, and the seam tests replace.
 *
 * ## Why the interface is this narrow
 *
 * The `Resend` class exposes two dozen resources — domains, contacts,
 * broadcasts, webhooks. This library sends transactional mail and nothing else,
 * so {@link EmailClient} declares the single method it calls. A test double is
 * then an object literal with one function on it, rather than a mock of a large
 * class, and the type checker still guarantees the double and the real SDK agree
 * on the payload and the response shape.
 *
 * Structural typing does the rest: a real `Resend` instance satisfies
 * {@link EmailClient} with no adapter and no cast.
 *
 * ## Why the client is memoized, and why the memo is keyed on the API key
 *
 * Cloud Run keeps an instance warm across requests, so constructing a client per
 * send would rebuild the same object and its keep-alive agent on every
 * registration. Memoizing at module scope is the same reasoning that governs
 * `getDb()` in `@upskills/firestore`.
 *
 * But a memo keyed on nothing would freeze the *first* key it ever saw, which
 * breaks the moment the environment changes underneath it — a test that sets a
 * key, or a process that picks up a rotated secret. Keying the memo on the key
 * itself keeps the warm path free while making a changed key take effect
 * immediately.
 */
export interface EmailClient {
  readonly emails: {
    send(payload: CreateEmailOptions): Promise<CreateEmailResponse>;
  };
}

/** Set by {@link setEmailClient}; wins over the environment when present. */
let injected: EmailClient | null = null;

/** The memoized real client, alongside the key it was built from. */
let memo: { key: string; client: EmailClient } | undefined;

/**
 * The client to send with, or `null` when this process has no API key.
 *
 * `null` rather than a throw: a missing key is a deployment fact, not a bug in
 * the caller, and the send path's whole contract is that it reports failure
 * instead of raising it. {@link sendEmail} turns this into a `not_configured`
 * result.
 */
export function getEmailClient(): EmailClient | null {
  if (injected) {
    return injected;
  }

  const key = resendApiKey();
  if (!key) {
    return null;
  }

  if (memo?.key !== key) {
    memo = { key, client: new Resend(key) };
  }

  return memo.client;
}

/**
 * Replace the client for the duration of a test, or restore the real one with
 * `null`.
 *
 * This exists so the suite can exercise the failure path — a 4xx, a 5xx, a
 * socket that dies mid-request — without an API key and without touching
 * Resend. Stubbing here rather than at `fetch` keeps the tests readable and
 * still covers everything this library owns, because the SDK call is the last
 * thing it does.
 *
 * Not for production wiring. Application code configures the key and lets
 * {@link getEmailClient} build the client.
 */
export function setEmailClient(client: EmailClient | null): void {
  injected = client;
}
