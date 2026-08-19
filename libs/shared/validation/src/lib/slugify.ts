/**
 * Turning human text into a slug, and getting out of the way when the slug is
 * already taken.
 *
 * Slug *uniqueness* is enforced by the database — `orgSlugs/{slug}` and
 * `organizers/{orgId}/eventSlugs/{slug}` reservation documents, see
 * `libs/data-access/firestore/src/lib/slugs.ts`. Nothing here can prevent a
 * collision, and nothing here should try: a check that runs before the write is
 * a guess that goes stale the moment somebody else commits.
 *
 * What lives here is the other half — proposing a slug worth attempting.
 * {@link slugify} turns a title into the first candidate, {@link nextSlugCandidate}
 * turns a rejected candidate into the next one, and {@link RESERVED_SLUGS} names
 * the slugs an organizer may never hold.
 */

/** Longest slug the reservation document id may be; matches `SlugSchema`. */
const MAX_SLUG_LENGTH = 80;

/**
 * Slugs an organizer may never take, because the org slug is a **top-level URL
 * segment**: the public organizer page is `/{orgSlug}` and an event is
 * `/{orgSlug}/{eventSlug}`.
 *
 * That puts organizer slugs in the same namespace as every static route in
 * `apps/web/src/app/pages`, so an org called `dashboard` would sit exactly where
 * the signed-in dashboard lives. Which one wins is a router-precedence detail,
 * and neither answer is one we want: the org shadows the app, or the app
 * silently swallows a slug somebody paid attention to choosing.
 *
 * The list is deliberately wider than the routes that exist today. Adding a
 * route later is a one-line change; discovering that an organizer already holds
 * the slug you need is a migration. Entries here cost nothing but a name nobody
 * gets to use.
 *
 * Event slugs are *not* checked against this list. They live under an org
 * (`/{orgSlug}/{eventSlug}`), so they can only ever shadow a route nested under
 * that organizer — and there are none.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Routes that exist today.
  'admin',
  'api',
  'auth',
  'dashboard',
  'events',
  'invites',
  'login',
  // Routes an app like this one grows.
  'about',
  'account',
  'billing',
  'blog',
  'callback',
  'checkout',
  'contact',
  'docs',
  'explore',
  'faq',
  'features',
  'help',
  'home',
  'legal',
  'logout',
  'me',
  'new',
  'notifications',
  'onboarding',
  'org',
  'organizer',
  'organizers',
  'orgs',
  'payment',
  'payments',
  'pricing',
  'privacy',
  'register',
  'search',
  'security',
  'settings',
  'signin',
  'signout',
  'signup',
  'sitemap',
  'support',
  'terms',
  'user',
  'users',
  'waitlist',
  'webhooks',
  // Infrastructure paths that must never be shadowed by a page.
  'assets',
  'public',
  'robots',
  'static',
  'well-known',
]);

/** Whether `slug` is one an organizer may never hold. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/**
 * A title as a slug candidate — `'React Basics: Part 2!'` → `'react-basics-part-2'`.
 *
 * Decomposing to NFD and dropping the combining marks is what turns `Café` into
 * `cafe` rather than `caf`: the accent becomes its own code point and falls to
 * the same filter as the punctuation. Anything still outside `[a-z0-9]` — CJK,
 * emoji, symbols — collapses to a separator, so a title with no Latin characters
 * slugifies to `''`.
 *
 * An empty result is returned as-is rather than substituted with a default. The
 * caller knows whether it is filling a form field the user can still edit or
 * writing a reservation, and only the second one is an error.
 *
 * @returns a value that satisfies `SlugSchema`, or `''`.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    // Combining diacritical marks, now separated from the letters they modified.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return truncateSlug(slug);
}

/**
 * The next candidate after `base` was rejected — `attempt` 2 gives `base-2`.
 *
 * Numbering starts at 2 because `base` itself was attempt 1: the first retry a
 * user sees is `react-basics-2`, which reads as the second React Basics rather
 * than as a machine's first fallback.
 *
 * The suffix is trimmed *into* the base rather than appended past the length
 * limit, so a maximum-length title still produces distinct candidates instead of
 * the same truncated string every time.
 *
 * @param attempt 1 returns `base` unchanged; 2 and up append a counter.
 */
export function nextSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }

  const suffix = `-${attempt}`;
  const room = MAX_SLUG_LENGTH - suffix.length;

  return `${truncateSlug(base.slice(0, room))}${suffix}`;
}

/**
 * Cut to the length limit without leaving a trailing hyphen.
 *
 * A slug ending in `-` is rejected by nothing — `SlugSchema` allows hyphens
 * anywhere — so this is about the URL rather than validity: `/acme/react-` is a
 * link that looks broken to the person reading it.
 */
function truncateSlug(slug: string): string {
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}
