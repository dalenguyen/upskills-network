import type { RouteMeta } from '@analogjs/router';

/**
 * `/login` — an alias that redirects to the real sign-in page at `/auth/login`.
 *
 * The page lives under `/auth/` because registration sits beside it, but
 * `/login` is what people type, bookmark, and paste into a browser. Without
 * this route the router has nothing to match and throws `NG04002`, which
 * renders as a blank page: no component, no error UI, nothing.
 *
 * This file has no default export on purpose. Analog treats a `.page.ts` whose
 * `routeMeta` carries `redirectTo` as a redirect-only route, so there is no
 * component to render and no flash of an empty page before the redirect.
 *
 * Angular's string `redirectTo` drops the original query string, so a link to
 * `/login?redirectTo=/dashboard` lands on `/auth/login` without the parameter
 * and signs the user in to `/` instead. That is acceptable because nothing in
 * the app produces such a link — `authGuard` builds `/auth/login?redirectTo=…`
 * against the canonical path directly (see `app/auth/auth-guard.ts`). If a
 * caller ever needs the parameter carried across this alias, the fix is a
 * redirect *function* rather than a string, which Analog's `RouteMeta` does not
 * currently type.
 */
export const routeMeta: RouteMeta = {
  redirectTo: '/auth/login',
  pathMatch: 'full',
};
