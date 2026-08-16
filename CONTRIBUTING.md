# Contributing to Upskills

Thanks for taking the time to contribute. This document covers how to get the
workspace running, what CI expects of a branch, and how changes get merged.

## Prerequisites

- **Node.js 24** — the version CI runs on.
- **pnpm 10** — the workspace is pnpm-only (`pnpm-lock.yaml`, lockfile v9). npm
  and yarn will not resolve the workspace protocol links correctly.
- **Firebase CLI** — only needed to run the `data-access-firestore` tests, which
  start a Firestore emulator themselves. It is not a workspace dependency.

## Getting started

```sh
pnpm install
pnpm start:web
```

Then open http://localhost:4200.

Sign-in and any other Firebase-backed flow need `apps/web/.env`. Copy the
checked-in template and fill in the values:

```sh
cp apps/web/.env.example apps/web/.env
```

Real `.env` files are gitignored. The Firebase web config in the template is
public by design — it ships in the client bundle — but the same file is where a
Stripe or Resend secret ends up, so it never gets committed.

## Working in the monorepo

This is an [Nx](https://nx.dev) workspace. Two rules matter more than the rest:

1. **Run tasks through Nx**, not the underlying tool: `pnpm exec nx test web`,
   not `pnpm vitest`. Nx handles the project graph, caching, and dependency
   ordering.
2. **Create apps and libs with generators**, never by hand:
   `pnpm exec nx g @nx/js:lib libs/shared/foo`. A hand-rolled folder misses the
   tsconfig, project.json, and lint wiring that every other project has.

| Command                              | Description                         |
| ------------------------------------ | ----------------------------------- |
| `pnpm start:web`                     | Serve the web app locally with HMR. |
| `pnpm build:web`                     | Production build of the web app.    |
| `pnpm typecheck`                     | Type-check all projects.            |
| `pnpm test`                          | Unit tests across all projects.     |
| `pnpm lint`                          | Lint all projects.                  |
| `pnpm exec nx affected -t test lint` | Only what your branch touched.      |

## Before you push

CI runs these, and a failure in any one of them blocks the merge:

```sh
pnpm exec nx format:check --base=origin/main
pnpm exec nx run-many -t lint build typecheck e2e
pnpm exec nx run-many -t test --exclude=data-access-firestore
```

`nx format:check` is a separate gate from lint — a green lint says nothing about
Prettier. Run `pnpm exec nx format:write` to fix formatting.

**If your change touches `libs/data-access/firestore`**, also run its tests
locally — CI skips them because the Firestore emulator needs the Firebase CLI,
which is not installed on the runner:

```sh
pnpm exec nx test data-access-firestore
```

Those specs are the only coverage of the transactional paths (`reserveSpot`'s
capacity, status, and price decisions, and its contention behaviour), so a
regression there reaches `main` green.

## Branches, commits, and pull requests

- **Never commit directly to `main`.** Branch, push, and open a pull request.
  `main` requires a passing CI run and an approving review.
- Name branches by intent: `feat/event-cancellation`, `fix/checkout-webhook`,
  `chore/bump-angular`, `ci/cache-pnpm-store`.
- Write commit subjects as [Conventional Commits](https://www.conventionalcommits.org/)
  scoped to the project you touched:

  ```
  feat(web): add New event button
  fix(firestore): expire held reservations after 15 minutes
  ci: gate deploy on push to main from this repo
  ```

  Keep the subject under ~50 characters. Add a body only when the "why" is not
  obvious from the diff.

- Keep pull requests focused. One behavioural change per PR reviews faster than
  a branch that also reformats three unrelated files.
- Resolve every review thread before merging, including automated reviewers.

## Reporting bugs and proposing features

Open an issue. For a bug, include what you did, what you expected, what
happened, and the versions of Node and pnpm you are on. For a feature, describe
the problem before the solution — the shape of the fix is usually the easier
half.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project.
