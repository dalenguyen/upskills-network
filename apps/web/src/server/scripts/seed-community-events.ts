import {
  CommunityEventSeedRowSchema,
  type CommunityEventSeed,
} from '@upskills/validation';

/**
 * The policy behind the curated community-events seed.
 *
 * Upskills lists events run by other people — a Meetup, an Eventbrite listing,
 * a conference — so its events page is worth reading before enough organizers
 * have joined to fill it themselves. The list is a checked-in JSON file, and
 * this module turns it into create/update decisions. The executable under
 * `apps/web/scripts/` owns the Firestore reads and writes.
 *
 * Kept free of `@upskills/firestore` (and therefore `firebase-admin`) so the
 * `web-server` Vitest project can prove the behaviour without pulling the Admin
 * SDK into the test graph — the same split as `backfill-user-emails.ts`.
 *
 * ## The slug is the identity
 *
 * Re-running is the normal case, not the exception: you add three events to the
 * file and run it again. So each row is matched to an existing event by its
 * slug within the org, and an existing one is **updated in place** rather than
 * duplicated. Editing a title or a date in the file and re-running therefore
 * corrects the live event. Editing a *slug* does not rename anything — it
 * creates a second event and leaves the first one published and stale.
 *
 * ## One bad row does not lose the batch
 *
 * Rows are validated individually and failures are collected, not thrown. A
 * typo'd timezone in row 7 must not abandon rows 8 through 20 halfway through a
 * run, leaving the file and the database disagreeing in a way that is only
 * discoverable by reading both.
 */

/**
 * The fields a seeded event is created or updated with.
 *
 * Extends the file row, so `startTimeTbd` passes straight through to the write
 * — a row that declares its start time unknown produces an event whose public
 * pages render the date alone.
 */
export interface CommunityEventDraft extends CommunityEventSeed {
  /**
   * Always `'published'`. A curated listing that is not published is a row you
   * should have deleted from the file.
   */
  status: 'published';
  /**
   * Zero, meaning **not applicable** rather than "free". Upskills does not set
   * or collect a price for an event it does not run; the public card suppresses
   * the price entirely for anything carrying an `externalUrl`, so this value is
   * never rendered as a claim about what the source charges.
   */
  price: 0;
  currency: 'cad';
  /** Zero — unlimited. Capacity belongs to whoever takes the registrations. */
  maxGuests: 0;
  /** uid the events are attributed to; resolved from the org's admins. */
  createdBy: string;
}

/** Why one row was rejected. */
export interface RejectedSeed {
  /** Position in the file, 0-based — the only way to find an unparsed row. */
  index: number;
  /** The row's slug when it had a usable one, for a legible report. */
  slug?: string;
  /** Human-readable validation problems, one per failing field. */
  problems: string[];
}

export interface SeedCommunityEventsResult {
  /** Slugs of events that did not exist and were written. */
  created: string[];
  /** Slugs of events that already existed and were overwritten in place. */
  updated: string[];
  rejected: RejectedSeed[];
}

export interface SeedCommunityEventsDeps {
  /**
   * Resolve `organizers/{orgId}/eventSlugs/{slug}` to an event id, or `null`.
   *
   * This is the reservation document the platform already maintains for every
   * event, so the seed reads the same index the public URL resolver does rather
   * than running a `where('slug', '==')` query of its own.
   */
  findEventIdBySlug(slug: string): Promise<string | null>;
  createEvent(draft: CommunityEventDraft): Promise<void>;
  updateEvent(eventId: string, draft: CommunityEventDraft): Promise<void>;
}

export interface SeedCommunityEventsOptions {
  /** uid recorded as `createdBy` on every event this run creates. */
  createdBy: string;
}

/**
 * Turn the curated file into events, creating what is missing and updating what
 * is not.
 *
 * @param rows the parsed JSON file, still untrusted — validated here.
 * @returns what happened to every row, including the ones that were refused.
 */
export async function seedCommunityEvents(
  rows: unknown,
  deps: SeedCommunityEventsDeps,
  options: SeedCommunityEventsOptions,
): Promise<SeedCommunityEventsResult> {
  const result: SeedCommunityEventsResult = {
    created: [],
    updated: [],
    rejected: [],
  };

  if (!Array.isArray(rows)) {
    result.rejected.push({
      index: 0,
      problems: ['The seed file must contain a JSON array of events.'],
    });

    return result;
  }

  // Slugs already handled *by this run*, which is not the same question as
  // "does this slug exist in Firestore". A file listing the same slug twice
  // would otherwise create the event on the first row and silently overwrite it
  // from the second — two entries in the file, one event, and no complaint.
  const seenSlugs = new Set<string>();

  for (const [index, row] of rows.entries()) {
    // One row at a time, deliberately. `CommunityEventSeedFileSchema` validates
    // the array whole, which answers "is this file well formed" but would let a
    // single bad row reject every good one alongside it.
    const parsed = CommunityEventSeedRowSchema.safeParse(row);

    if (!parsed.success) {
      result.rejected.push({
        index,
        ...(slugOf(row) === undefined ? {} : { slug: slugOf(row) }),
        problems: parsed.error.issues.map(
          (issue) =>
            (issue.path.length > 0 ? issue.path.join('.') + ': ' : '') +
            issue.message,
        ),
      });
      continue;
    }

    const seed = parsed.data;

    if (seenSlugs.has(seed.slug)) {
      result.rejected.push({
        index,
        slug: seed.slug,
        problems: ['Duplicate slug — an earlier row in this file claims it.'],
      });
      continue;
    }

    seenSlugs.add(seed.slug);

    const draft: CommunityEventDraft = {
      ...seed,
      status: 'published',
      price: 0,
      currency: 'cad',
      maxGuests: 0,
      createdBy: options.createdBy,
    };

    const existingId = await deps.findEventIdBySlug(seed.slug);

    if (existingId === null) {
      await deps.createEvent(draft);
      result.created.push(seed.slug);
    } else {
      await deps.updateEvent(existingId, draft);
      result.updated.push(seed.slug);
    }
  }

  return result;
}

/** A row's slug, if it has anything resembling one, for the failure report. */
function slugOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) {
    return undefined;
  }

  const slug = (row as { slug?: unknown }).slug;

  return typeof slug === 'string' && slug.length > 0 ? slug : undefined;
}
