# shared-models

Firestore document shapes for the whole workspace, imported as `@upskills/models`.

**Types only — this lib has no runtime imports.** That is deliberate: it is
consumed by both the server routes and the browser bundle, so pulling in
`firebase-admin` (or zod) here would leak the Admin SDK into the client. The
Firestore `Timestamp` is therefore declared structurally in `src/lib/timestamp.ts`;
a real `firebase-admin` `Timestamp` satisfies it without a cast.

| Type            | Document                            |
| --------------- | ----------------------------------- |
| `User`          | `users/{uid}`                       |
| `Organizer`     | `organizers/{orgId}`                |
| `WorkshopEvent` | `events/{eventId}` (top-level)      |
| `Guest`         | `events/{eventId}/guests/{guestId}` |

Conventions worth knowing before you touch these:

- `Guest.guestId` **is** the normalized email — derive it only with
  `normalizeEmail()` from `@upskills/validation`.
- `Organizer.members` is a map keyed by uid (security rules cannot index an
  array of objects); `memberUids` mirrors its keys for `array-contains` queries.
- `WorkshopEvent.price`/`Guest.amountPaid` are in **minor units** (cents).
- `WorkshopEvent.timezone` is an **IANA** name, e.g. `America/Toronto`.
- `WorkshopEvent.maxGuests` of `0` means unlimited.

## Running unit tests

Run `nx test shared-models` to execute the unit tests via [Vitest](https://vitest.dev/).
