/**
 * Where this library gets its API key, its sender, and the origin it builds
 * links against.
 *
 * ## Everything is read at call time, never at module load
 *
 * The obvious shape — `const API_KEY = process.env['RESEND_API_KEY']` beside a
 * `new Resend(API_KEY)` at the top of the file — makes the library unimportable
 * anywhere the key is absent. That is not a hypothetical: the test suite renders
 * templates without ever sending, the SSR bundle imports this lib from routes
 * that only read, and a template preview has no business needing a production
 * credential. Reading lazily means importing `@upskills/email` costs nothing and
 * asserts nothing, and only the call that actually sends has to be configured.
 *
 * It also means the environment can change between calls, which is what lets a
 * test set a key, exercise the send path, and unset it again without reaching
 * into module internals.
 */

/** Resend API key. Provisioned into Cloud Run from Secret Manager. */
export const RESEND_API_KEY_ENV = 'RESEND_API_KEY';

/** `From` header, e.g. `Upskills Network <hello@example.com>`. */
export const EMAIL_FROM_ENV = 'EMAIL_FROM';

/** Where guest replies should land — usually a human-monitored inbox. */
export const EMAIL_REPLY_TO_ENV = 'EMAIL_REPLY_TO';

/** Public origin of the site, used to build every link in every template. */
export const SITE_URL_ENV = 'SITE_URL';

/**
 * The sender used until the real domain is verified.
 *
 * Resend accepts `onboarding@resend.dev` from any account but **only delivers it
 * to the account owner's own address**, which is exactly enough to build and
 * eyeball templates and not nearly enough to serve guests. Defaulting to it
 * keeps development working with zero configuration; production sets
 * `EMAIL_FROM` to the verified domain.
 */
export const DEFAULT_FROM = 'Upskills Network <onboarding@resend.dev>';

/**
 * Origin used when `SITE_URL` is unset.
 *
 * A local default rather than a guessed production hostname: a link to
 * `localhost` in a real guest's inbox is obviously broken and gets reported,
 * whereas a link to a plausible-but-wrong domain looks fine and silently fails.
 */
export const DEFAULT_SITE_URL = 'http://localhost:4200';

/** The Resend API key, or `undefined` when this process cannot send mail. */
export function resendApiKey(): string | undefined {
  return trimmedEnv(RESEND_API_KEY_ENV);
}

/** The `From` header every message is sent with. */
export function fromAddress(): string {
  return trimmedEnv(EMAIL_FROM_ENV) ?? DEFAULT_FROM;
}

/**
 * The `Reply-To` header, when one is configured.
 *
 * It matters more than it looks: the cancellation and refund templates tell the
 * guest to contact the organizer, and the organizer's own address is not in the
 * data model. A monitored reply-to is the only route back that those emails can
 * offer, so leaving it unset makes that instruction a dead end.
 */
export function replyToAddress(): string | undefined {
  return trimmedEnv(EMAIL_REPLY_TO_ENV);
}

/**
 * The site origin, with any trailing slash removed.
 *
 * Trimming here rather than at each use is what keeps `${siteUrl()}/events/…`
 * from producing a double slash when someone sets `SITE_URL=https://example.com/`
 * — cosmetic in a browser, but it makes link comparison in tests and in analytics
 * depend on how the environment variable happened to be typed.
 */
export function siteUrl(): string {
  const configured = trimmedEnv(SITE_URL_ENV) ?? DEFAULT_SITE_URL;
  return configured.replace(/\/+$/, '');
}

/**
 * An environment variable, or `undefined` when it is missing or blank.
 *
 * An empty string is treated as absent on purpose: a secret that failed to
 * inject usually surfaces as `''`, and `new Resend('')` would fail later and
 * further away than "not configured" does here.
 */
function trimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
