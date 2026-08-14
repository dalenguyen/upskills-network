import type { Timestamp } from './timestamp';

/**
 * Platform-wide role. Org-level authority is **not** stored here — it lives on
 * {@link Organizer.members}, keyed by uid.
 */
export type PlatformRole = 'admin' | 'user';

/** Global identity document: `users/{uid}`. */
export interface User {
  uid: string;
  email: string;
  name?: string;
  /** Platform role only; defaults to `'user'`. */
  role: PlatformRole;
  /** Denormalized list of org ids, for the "my orgs" lookup without a query. */
  orgIds: string[];
  createdAt: Timestamp;
}
