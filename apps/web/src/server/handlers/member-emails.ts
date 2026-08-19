/**
 * Roster enrichment that cannot fail a write that already committed.
 *
 * ## Why this exists
 *
 * The member and invite routes answer `{ org, … }` with each member's email
 * resolved from `users/{uid}`. That resolution is a *read*, and on the write
 * paths it happens **after** the mutation has durably committed. Letting it
 * throw would turn "the role changed, then a lookup blipped" into a 500, and
 * the browser would report a change that actually landed as failed — the worst
 * of both, because the operator then retries a write that already happened.
 *
 * So on write paths the enrichment degrades instead: a failed lookup answers no
 * emails, the projection falls back to uids, and the response still tells the
 * truth about what was written. The next page load resolves the emails.
 *
 * ## Why the read paths do not use this
 *
 * A `GET` that cannot resolve emails has mutated nothing, so failing loudly is
 * right: the caller retries and gets a correct page, rather than silently being
 * shown a roster of uids and left to wonder.
 */

/** `getUserEmails`, downgraded to "no emails" when the lookup fails. */
export async function emailsAfterWrite(
  getUserEmails: (uids: string[]) => Promise<Record<string, string>>,
  uids: string[],
): Promise<Record<string, string>> {
  try {
    return await getUserEmails(uids);
  } catch {
    return {};
  }
}

/** As {@link emailsAfterWrite}, for the invitation list beside the roster. */
export async function listAfterWrite<T>(
  list: (orgId: string) => Promise<T[]>,
  orgId: string,
): Promise<T[]> {
  try {
    return await list(orgId);
  } catch {
    return [];
  }
}
