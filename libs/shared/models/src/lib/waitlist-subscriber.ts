import type { Timestamp } from './timestamp';

/**
 * Waitlist subscriber document: `waitlist/{normalizedEmail}`.
 *
 * `normalizedEmail` is `normalizeEmail(email)` — trim + lowercase — exactly as
 * for guest documents, which is what makes a duplicate signup the same document
 * id rather than a second row to deduplicate by query.
 */
export interface WaitlistSubscriber {
  /** Normalized email (trimmed + lowercased) — the doc id. */
  email: string;
  createdAt: Timestamp;
}
