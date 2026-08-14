/**
 * Structural stand-in for the Firestore `Timestamp` class.
 *
 * This library is deliberately free of runtime imports (issue #28), so it cannot
 * import `Timestamp` from `firebase-admin/firestore`: that is a *value* import,
 * and it would drag the Admin SDK into every consumer of `@upskills/models`,
 * including the browser bundle.
 *
 * Declaring the shape structurally instead costs nothing and stays compatible:
 * TypeScript is structurally typed, so a real `firebase-admin` `Timestamp` (and
 * the client SDK's `Timestamp`, which exposes the same two methods) is assignable
 * to this interface with no cast at the call site. Only the members the app
 * actually reads are declared — `seconds`/`nanoseconds` are intentionally left
 * out so the surface stays minimal.
 */
export interface Timestamp {
  /** The timestamp as a JS `Date` (millisecond precision). */
  toDate(): Date;
  /** Milliseconds since the Unix epoch. */
  toMillis(): number;
}
