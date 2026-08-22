import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';

import { AuthService } from './auth-service';
import { POST_AUTH_LANDING, safeRedirectTarget } from './sign-in-errors';

/**
 * The mirror of {@link authGuard}: keeps an already-signed-in visitor off the
 * sign-in and registration pages, and sends them where they were going.
 *
 * Without this, a signed-in visitor who reaches `/auth/login` — from the
 * header, from a bookmark, from the browser's back button after a redirect —
 * is shown a sign-in form for the account they are already using. Signing in
 * again works, so the page looks fine and the bug reads as "I had to sign in
 * twice".
 *
 * Like `authGuard`, this is a convenience and not a security boundary. It
 * grants nothing: `/dashboard` still gets its data from a route that verifies
 * the `__session` cookie server-side.
 *
 * ## This cannot loop with `authGuard`
 *
 * The pair looks like it could ping-pong — this one says "you are signed in,
 * go to the dashboard", `authGuard` says "you are not, go to the login page" —
 * but they read the same signal, `AuthService.currentUser()`, so they cannot
 * disagree about the same moment.
 *
 * The interesting case is a browser signed in to Firebase whose `__session`
 * cookie is gone. This admits the visitor to `/dashboard`; the page's data
 * load answers 401 `invalid-session`; `invalidSessionInterceptor` signs the
 * browser out *before* it navigates to `/auth/login`. So by the time this
 * guard runs again there is no user and it stands aside. One bounce, then the
 * sign-in form, which is the correct outcome.
 */
export const guestGuard: CanActivateFn = async (
  route,
): Promise<boolean | UrlTree> => {
  // No client SDK on the server and no persisted session to consult, so this
  // guard has no opinion — same reasoning as `authGuard`. Forming one here
  // would redirect every server-rendered sign-in page.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  // `currentUser()` rather than a peek at `authState$`: on a hard refresh the
  // SDK restores a persisted session asynchronously, and acting before it
  // resolves would show the sign-in form to someone who is already signed in —
  // the exact bug this guard exists to close.
  const user = await auth.currentUser();

  if (user === null) {
    return true;
  }

  // `parseUrl` rather than `createUrlTree([...])`: `redirectTo` is a path that
  // may carry its own query string (`/dashboard/events?status=draft`), and an
  // array segment would treat the whole thing as one literal segment.
  return router.parseUrl(destinationFor(route.queryParamMap.get('redirectTo')));
};

/**
 * Where to send a visitor who is already signed in.
 *
 * An `/auth/…` target is rejected on top of the same-origin check: the guard
 * runs on every `/auth/…` page, so honouring `?redirectTo=/auth/login` would
 * redirect to a route that immediately redirects again. Angular gives up on
 * that after a few hops, but with an error rather than a usable page.
 */
function destinationFor(redirectTo: string | null): string {
  const target = safeRedirectTarget(redirectTo, POST_AUTH_LANDING);
  return target.startsWith('/auth/') ? POST_AUTH_LANDING : target;
}
