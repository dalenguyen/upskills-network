# Upskills

Upskills is a platform for in-person workshops and networking events. Organizers create and publish paid workshop events, and guests register, pay via Stripe, and receive transactional email via Resend. The app is a single Nx workspace (`@upskills/source`) built with Angular + AnalogJS for server-side rendering, Firebase for auth and data (Firestore), and deployed as a container to Cloud Run.

## Tech stack

- **Monorepo**: Nx 23, pnpm
- **Frontend**: Angular 22 + AnalogJS (SSR, Vite), Tailwind CSS v4
- **Backend/data**: Firebase (client SDK + firebase-admin, Firestore + Auth), Nitro server routes
- **Payments/email**: Stripe, Resend
- **Validation**: zod
- **Tests**: Vitest + Jest + Playwright

## Repo structure

- `apps/web` — the Analog/Angular web app. File-based routes in `apps/web/src/app/pages/`, Nitro server routes (Stripe webhook, auth, API) in `apps/web/src/server/routes/`.
- `libs/shared/models` (`@upskills/models`) — domain types: `WorkshopEvent`, `Guest`, `Organizer`, `User`.
- `libs/shared/validation` (`@upskills/validation`) — zod schemas and `normalizeEmail`.
- `libs/data-access/firestore` (`@upskills/firestore`) — Firestore data access.
- `libs/data-access/email` (`@upskills/email`) — Resend client and transactional email templates.
- `libs/data-access/auth` (`@upskills/auth`) — Firebase Auth services.
- `libs/data-access/stripe` (`@upskills/stripe`) — Stripe checkout and webhook handling.
- `libs/ui` (`@upskills/ui`) — shared UI primitives.
- `libs/gcloud` (`@upskills/gcloud`) — Nx executor for Cloud Run deploys.

## Quick start

```sh
pnpm install
pnpm start:web
```

Then open http://localhost:4200.

## Common commands

| Command           | Description                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm start:web`  | Serve the web app locally with HMR (`nx serve web`).                                                                         |
| `pnpm build:web`  | Production build of the web app (`nx build web`).                                                                            |
| `pnpm typecheck`  | Type-check all projects (`nx run-many -t typecheck`).                                                                        |
| `pnpm test`       | Run unit tests across all projects (`nx run-many -t test`).                                                                  |
| `pnpm lint`       | Lint all projects (`nx run-many -t lint`).                                                                                   |
| `pnpm deploy:web` | Deploy the web app: build a Docker image and push it, then deploy the `upskills-web` service to Cloud Run (`nx deploy web`). |

## Domain model

An organizer hosts a workshop event (`events/{eventId}`) with a price, capacity, and lifecycle (`draft` → `published` → `cancelled`). A guest registers against an event; their registration is a `Guest` document keyed by normalized email and carries a status: `pending` (waitlist), `held` (paid reservation awaiting the Stripe webhook), `confirmed` (holds a spot), `cancelled`, or `expired` (a held reservation whose payment never landed).
