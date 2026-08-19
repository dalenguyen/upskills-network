import type {
  InviteAcceptResponse,
  InviteDetailResponse,
} from '../../server/handlers/invites/invite-accept';

/**
 * The invitee's half of the invitation API, as the browser sees it.
 *
 * Deliberately not part of `dashboard-api.ts`: these two routes are the only
 * ones a person can call before they belong to anything. The visitor opening
 * them arrives from an email with no session and often no account, and the
 * page that uses them is not a dashboard page. Keeping them here means the
 * public accept page never imports the organizer's API surface to reach them.
 *
 * The types come from the server handlers by `import type`, the same as the
 * other API modules — erased at compile time, so nothing from `src/server`
 * reaches the browser bundle, but a renamed field breaks the type-check here
 * instead of rendering `undefined`.
 */

export type { InviteAcceptResponse, InviteDetailResponse };

/**
 * `GET` — what one invitation offers, by its emailed token.
 *
 * The token is a credential, so it is path-encoded like every other id here:
 * it must not be able to smuggle a `/` into the request.
 */
export function inviteDetailEndpoint(token: string): string {
  return `/api/v1/invites/${encodeURIComponent(token)}`;
}

/** `POST` — accept the invitation this token names. Requires a session. */
export function inviteAcceptEndpoint(token: string): string {
  return `/api/v1/invites/${encodeURIComponent(token)}/accept`;
}
