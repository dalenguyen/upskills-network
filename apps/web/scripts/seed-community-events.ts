import {
  createEvent,
  eventSlugRef,
  getOrgBySlug,
  updateEvent,
} from '@upskills/firestore';
import type { Organizer } from '@upskills/models';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  seedCommunityEvents,
  type CommunityEventDraft,
  type SeedCommunityEventsDeps,
  type SeedCommunityEventsResult,
} from '../src/server/scripts/seed-community-events';

/**
 * Seed the curated community events listed in `scripts/data/community-events.json`.
 *
 * These are events other people run — a Meetup, an Eventbrite listing, a
 * conference — that Upskills lists so its events page is worth reading. They
 * become ordinary published event documents under one organizer, carrying an
 * `externalUrl` that makes the registration path refuse them and the public
 * pages send visitors to the source instead.
 *
 * ## Usage
 *
 * Run from the repo root with a TypeScript runner that resolves the workspace
 * path aliases (the same aliases Vite uses for the server bundle):
 *
 *     seed-community-events --org=<orgSlug> [--file=<path>] [--dry-run]
 *
 * `--dry-run` reads and validates everything, resolves every slug against the
 * live database, and prints exactly what it *would* write without writing it.
 * Run it first. Against production, run it first every time.
 *
 * ## Idempotent by slug
 *
 * A row whose slug already exists under the org updates that event in place;
 * anything else is created. So the normal workflow is: add rows to the JSON,
 * re-run, and the second run reports every previously-seeded event as an
 * update. If a re-run reports creates for events you have already seeded, a
 * slug changed — check the file before assuming the database is wrong.
 *
 * ## Why `createdBy` is not a flag
 *
 * Every event needs a creator uid. Passing one by hand is a way to attribute
 * events to somebody who is not in the org, so it is read from the org document
 * instead: the first member holding the `admin` role. There is always at least
 * one — `ensureNotLastAdmin` in `orgs.ts` is what guarantees it.
 */

interface Args {
  orgSlug: string;
  file: string;
  dryRun: boolean;
}

const DEFAULT_FILE = 'apps/web/scripts/data/community-events.json';

/** Read the flags, or explain what was missing and stop. */
function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();

  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) {
      flags.set(match[1], match[2] ?? 'true');
    }
  }

  const orgSlug = flags.get('org');

  if (!orgSlug || orgSlug === 'true') {
    throw new Error(
      'Missing --org=<orgSlug>. Example: --org=community --dry-run',
    );
  }

  return {
    orgSlug,
    file: flags.get('file') ?? DEFAULT_FILE,
    dryRun: flags.has('dry-run'),
  };
}

/** The uid every seeded event is attributed to — see the module comment. */
function firstAdminUid(org: Organizer): string {
  const admin = Object.entries(org.members).find(
    ([, membership]) => membership.role === 'admin',
  );

  if (!admin) {
    throw new Error(
      `Organizer "${org.slug}" has no admin member to attribute events to.`,
    );
  }

  return admin[0];
}

/**
 * Deps that write, or deps that only look.
 *
 * A dry run still resolves every slug against the live database — that read is
 * what decides create-vs-update, and reporting it wrongly would defeat the
 * point of the rehearsal. Only the two writes are stubbed out.
 */
function depsFor(orgId: string, dryRun: boolean): SeedCommunityEventsDeps {
  const findEventIdBySlug = async (slug: string): Promise<string | null> => {
    const reservation = (await eventSlugRef(orgId, slug).get()).data();
    return reservation?.eventId ?? null;
  };

  if (dryRun) {
    return {
      findEventIdBySlug,
      createEvent: async () => undefined,
      updateEvent: async () => undefined,
    };
  }

  return {
    findEventIdBySlug,
    createEvent: async (draft: CommunityEventDraft) => {
      await createEvent(orgId, draft);
    },
    updateEvent: async (eventId: string, draft: CommunityEventDraft) => {
      // `createdBy` is deliberately not in the patch: it records who first
      // added the event and is not the seed's to rewrite. `slug` is not either
      // — it is what matched this row to this event, so passing it would ask
      // the data layer to rename a slug to itself.
      const { createdBy, slug, ...patch } = draft;
      void createdBy;
      void slug;

      await updateEvent(orgId, eventId, patch);
    },
  };
}

/** Print what happened, loudly enough that a rejected row is not missed. */
function report(result: SeedCommunityEventsResult, dryRun: boolean): void {
  const prefix = dryRun ? '[dry run] would have' : '';

  console.log(
    `${prefix} created ${result.created.length}, updated ${result.updated.length}, rejected ${result.rejected.length}`.trim(),
  );

  for (const slug of result.created) {
    console.log(`  + ${slug}`);
  }

  for (const slug of result.updated) {
    console.log(`  ~ ${slug}`);
  }

  for (const rejected of result.rejected) {
    const name = rejected.slug ?? `row ${rejected.index}`;
    console.error(`  ! ${name}: ${rejected.problems.join('; ')}`);
  }
}

/**
 * Exported so it can be driven directly, without the `process.argv` guard
 * below deciding whether anything happens. Still reads its arguments from
 * `process.argv`, because that is what it is for.
 */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const org = await getOrgBySlug(args.orgSlug);

  if (!org) {
    throw new Error(`No organizer with slug "${args.orgSlug}".`);
  }

  const rows: unknown = JSON.parse(await readFile(args.file, 'utf8'));

  const result = await seedCommunityEvents(
    rows,
    depsFor(org.orgId, args.dryRun),
    { createdBy: firstAdminUid(org) },
  );

  report(result, args.dryRun);

  // A rejected row is a failure of the run, not a footnote to it. Exiting
  // non-zero is what stops a rejection scrolling past unnoticed.
  if (result.rejected.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Community events seed failed:', error);
    process.exitCode = 1;
  });
}
