/**
 * The one and only email normalizer.
 *
 * The guest doc id **is** the output of this function
 * (`events/{eventId}/guests/{normalizeEmail(email)}`), which is what makes
 * double-registration impossible without a query. A second implementation that
 * normalized differently would mint a second doc id for the same person and
 * recreate exactly the duplicate registrations this design prevents — so every
 * caller, including the Zod email schema in this lib, must route through here.
 *
 * Deliberately conservative: trim + lowercase only. No dot-stripping, no
 * `+tag` removal — those are provider-specific and would merge addresses that
 * really are distinct mailboxes.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
