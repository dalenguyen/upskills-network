# shared-validation

Zod schemas for every route boundary, imported as `@upskills/validation`.
Server routes parse through these — no ad-hoc parsing anywhere else.

| Schema                                                       | Boundary               |
| ------------------------------------------------------------ | ---------------------- |
| `CreateEventSchema` / `UpdateEventSchema`                    | organizer event CRUD   |
| `RegisterGuestSchema` / `CancelGuestSchema` / `LookupSchema` | public guest flows     |
| `CheckInSchema`                                              | staff check-in         |
| `CreateOrgSchema` / `OrgMemberSchema`                        | organizer + membership |

Ids that identify the resource (`orgId`, `eventId`) come from the route path and
the authenticated session, never from the request body — hence `CancelGuestSchema`
carries only `email` + `cancelToken`.

## `normalizeEmail()`

The single email normalizer in the codebase, and the one the `EmailSchema`
transform calls. The guest doc id **is** its output
(`events/{eventId}/guests/{normalizeEmail(email)}`), so a second implementation
that normalized differently would mint duplicate registrations. Trim + lowercase
only — no dot-stripping or `+tag` removal, which would merge distinct mailboxes.

## Running unit tests

Run `nx test shared-validation` to execute the unit tests via [Vitest](https://vitest.dev/).
