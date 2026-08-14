import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from './auth-service';

/**
 * # This guard is not a security boundary. It is a redirect.
 *
 * It decides nothing about what a user is allowed to see. It runs in the
 * browser, in code the user controls, against state the user can edit in a
 * devtools console; anyone who wants past it gets past it in about ten seconds.
 * Its entire job is to spare a signed-out visitor a page that would render
 * empty and then error — a nicety, at the same level as a loading spinner.
 *
 * **Every page this guard protects must get its data from a route that
 * re-checks the session cookie server-side.** That check — `requireAuth` /
 * `requireOrgRole` in `@upskills/auth`, reading the `HttpOnly` `__session`
 * cookie the browser cannot forge — is the only thing standing between a
 * visitor and the data. If a page's data would still arrive with this guard
 * deleted, that page has no protection at all, and adding this guard to it does
 * not give it any.
 *
 * If you are reading this because you are about to guard a new route: putting
 * `canActivate: [authGuard]` on it is the last five percent of the work. The
 * first ninety-five is the server-side check on whatever loads its data.
 *
 * ## Why it reads client state and not `GET /api/v1/auth/me`
 *
 * `me.get` knows something this does not: whether the `__session` cookie is
 * still good. But asking costs a round trip on every guarded navigation to
 * decide a redirect, and the answer is only ever advisory — by the time the
 * page renders it may already be stale. When the two disagree (the SDK says
 * signed in, the cookie is gone or revoked), this guard admits the visitor and
 * the page's own server-side load answers 401. That is the intended failure:
 * the check that matters ran, in the place where it counts.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  // On the server there is no client SDK and no persisted session to consult,
  // so this guard has no opinion and must not form one: redirecting here would
  // turn every server-rendered guarded page into a login redirect, including
  // for users whose session cookie is perfectly valid. The render proceeds and
  // the page's own server-side data load makes the real decision.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  // `currentUser()` rather than a peek at `authState$`: on a hard refresh the
  // SDK restores a persisted session asynchronously, and acting on the state
  // before it resolves bounces a signed-in user to the login page.
  const user = await auth.currentUser();

  if (user !== null) {
    return true;
  }

  return router.createUrlTree(['/auth/login'], {
    // So the login page can return the visitor where they were headed
    // (issue #58). A URL, not a page's data — nothing sensitive travels here.
    queryParams: { redirectTo: state.url },
  });
};
