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

| Helper                                      | Path / index                                             |
| ------------------------------------------- | -------------------------------------------------------- |
| `getUser(uid)`                              | `users/{uid}`                                            |
| `getOrg(orgId)`                             | `organizers/{orgId}`                                     |
| `getOrgBySlug(slug)`                        | `orgSlugs/{slug}` → `organizers/{orgId}`                 |
| `getEvent(eventId)`                         | `events/{eventId}`                                       |
| `getEventBySlug(slug)`                      | `eventSlugs/{slug}` → `events/{eventId}`                 |
| `listPublishedEvents({ cursor, limit })`    | `events` — `status ASC, startsAt ASC`                    |
| `listOrgEvents(orgId, { limit })`           | `events` — `orgId ASC, startsAt DESC`                    |
| `listEventGuests(eventId, { status })`      | `guests` — `status ASC, registeredAt ASC` when filtered  |
| `getGuest(eventId, email)`                  | `events/{eventId}/guests/{normalizeEmail(email)}`        |
| `findRegistrationsByEmail(email)`           | `guests` collection group — `email ASC, registeredAt DESC` |

Slug lookups are two key reads through the reservation doc, never a
`where('slug', '==', …)` query.

`listPublishedEvents` returns `{ events, nextCursor }`. `nextCursor` is an
opaque string; pass it back as `cursor` for the next page, and stop when it is
`null`.

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
