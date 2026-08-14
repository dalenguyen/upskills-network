# data-access-firestore

Server-side Firestore access via the Admin SDK. Import as `@upskills/firestore`.

**Server only.** This library pulls in `firebase-admin`; nothing here may be
imported from browser code.

## `getDb()`

One lazily-initialized, memoized `Firestore` client. Credentials come from
**Application Default Credentials** — the Cloud Run service account in
production, `gcloud auth application-default login` locally. There is no
service-account key file anywhere in this repo.

There is **no code branch** between test and production. When
`FIRESTORE_EMULATOR_HOST` is set the Admin SDK routes everything to the emulator
by itself; when it is not, the same code talks to real Firestore.

## Reads

All non-mutating, all returning `null` / `[]` when nothing matches:

| Helper                                   | Path / index                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| `getUser(uid)`                           | `users/{uid}`                                              |
| `getOrg(orgId)`                          | `organizers/{orgId}`                                       |
| `getOrgBySlug(slug)`                     | `orgSlugs/{slug}` → `organizers/{orgId}`                   |
| `getEvent(eventId)`                      | `events/{eventId}`                                         |
| `getEventBySlug(slug)`                   | `eventSlugs/{slug}` → `events/{eventId}`                   |
| `listPublishedEvents({ cursor, limit })` | `events` — `status ASC, startsAt ASC`                      |
| `listOrgEvents(orgId, { limit })`        | `events` — `orgId ASC, startsAt DESC`                      |
| `listEventGuests(eventId, { status })`   | `guests` — `status ASC, registeredAt ASC` when filtered    |
| `getGuest(eventId, email)`               | `events/{eventId}/guests/{normalizeEmail(email)}`          |
| `findRegistrationsByEmail(email)`        | `guests` collection group — `email ASC, registeredAt DESC` |

Slug lookups are two key reads through the reservation doc, never a
`where('slug', '==', …)` query.

`listPublishedEvents` returns `{ events, nextCursor }`. `nextCursor` is an
opaque string; pass it back as `cursor` for the next page, and stop when it is
`null`.

## Transactional writes

Every mutation is one `runTransaction`. A read-then-write pair anywhere in this
library is a bug: "count the guests, then create one if there's room" is a lost
update, and two simultaneous registrations will oversell the last seat.

| Function                                           | Transition                         | Counters                             |
| -------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| `reserveSpot(eventId, draft, 'confirm' \| 'hold')` | → `confirmed` / `held` / `pending` | the matching counter up              |
| `confirmHeldGuest(eventId, email, paymentInfo)`    | `held` → `confirmed`               | `heldCount--`, `confirmedCount++`    |
| `releaseHold(eventId, email)`                      | `held` → `expired`                 | `heldCount--`                        |
| `cancelGuest(eventId, email)`                      | any active → `cancelled`           | whichever counter matched            |
| `promoteNextPending(eventId)`                      | oldest `pending` → `confirmed`     | `pendingCount--`, `confirmedCount++` |

`reserveSpot` returns `{ outcome, alreadyRegistered, guest }`. `outcome` is
`'confirmed' | 'held' | 'waitlisted'`; `alreadyRegistered` is the idempotent
"already registered" answer — the guest already occupied a place and nothing was
written, so skip the welcome email. A guest whose previous registration was
`cancelled` or `expired` registers afresh instead.

The other three return `{ changed, guest, reason? }`. `changed: false` with a
`reason` of `'not-found'`, `'already-applied'` or `'wrong-status'` is a normal
outcome, never an error — cancel links get clicked twice and Stripe redelivers
webhooks. `promoteNextPending` returns the promoted guest, or `null` when the
waitlist is empty or the event has no room.

Capacity: `maxGuests === 0` is unlimited; otherwise a seat is free when
`confirmedCount + heldCount < maxGuests`. Holds count, because a seat
mid-checkout is not a seat available. `waitlistPosition` is the rank at
registration, for the "you are #4" email — cancellations shrink `pendingCount`
without renumbering, so `registeredAt` is the authoritative ordering.

### Adding a mutation

Follow the pattern in `transactions.ts`, which is what keeps the counters exact:

1. Read everything first — Firestore rejects a read after a write.
2. Decide from what the transaction just read, never from a value fetched
   earlier.
3. Write absolute counter values via `applyCounters`, not
   `FieldValue.increment`; inside a transaction the read value is current at
   commit, and this way the counters clamp at zero.
4. Write the whole guest document with `transaction.set`, so fields that no
   longer apply (`waitlistPosition`, `holdExpiresAt`) simply disappear.

Use the `runTransaction` wrapper rather than `getDb().runTransaction`: it
carries the retry budget that lets a registration burst on one event queue
behind itself instead of surfacing an `ABORTED` to the caller.

## Emulator-backed tests

`pnpm nx test data-access-firestore` starts the Firestore emulator, runs the
suite against it, and shuts it down. It needs Java and the `firebase` CLI on
`PATH` — but no `firebase login`, no network, and no GCP project: the tests use
the demo project `demo-upskills`, which the CLI keeps entirely offline.

Ports and settings come from `firebase.json` at the repo root. If an emulator is
already listening there, the harness reuses it and leaves it running.

Writing a test:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore } from '../testing/emulator';
import { seedEvent, seedGuest, at } from '../testing/seed';
import { getGuest } from './reads';

beforeEach(clearFirestore); // every test starts from an empty database

it('reads back a seeded guest', async () => {
  await seedEvent({ eventId: 'evt-1' });
  await seedGuest({ eventId: 'evt-1', email: 'ada@example.com' });

  expect(await getGuest('evt-1', 'ada@example.com')).toMatchObject({
    guestId: 'ada@example.com',
  });
});
```

`seedUser` / `seedOrg` / `seedEvent` / `seedGuest` write a complete valid
document with your overrides applied and return it. `T0` and `at(minutes)` give
fixed timestamps for ordering assertions.

Test files run one at a time (`fileParallelism: false`) because they share one
emulator database.
