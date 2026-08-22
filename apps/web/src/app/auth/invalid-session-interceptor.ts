import { isPlatformBrowser } from '@angular/common';
import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { apiErrorCode } from '../events/event-api';
import { AuthService, SESSION_ENDPOINT } from './auth-service';
import { BYPASS_SESSION_RECOVERY, SessionProbe } from './session-probe';

/**
 * On a 401 `invalid-session` from any API call, sign out locally and send the
 * visitor to `/auth/login` instead of leaving every guarded page to render its
 * own "Something went wrong" for a session that is simply gone.
 *
 * ## The 401 is confirmed before anything is torn down
 *
 * The cookie belongs to the origin, not to a tab, so a 401 only proves that
 * the cookie *that request carried* was no good — not that the browser has no
 * session now. A request from a tab left open, answered after the visitor
 * signed in again elsewhere, describes a session that has since been replaced.
 *
 * Acting on it destroyed the replacement, which is how signing in came to look
 * like it needed doing twice. So a 401 sends {@link SessionProbe} to re-ask
 * with the current cookie: if a newer session answers, the request is retried
 * against it and nothing is signed out. Retrying is safe because a 401
 * `invalid-session` is refused by the authorization check, before any handler
 * runs — there is no half-applied write to worry about.
 *
 * ## Local sign-out only
 *
 * The teardown is {@link AuthService.forgetSession}, not `logout()`: the server
 * has just said this session is not valid, so there is nothing left to revoke,
 * and `logout()`'s DELETE would revoke whatever *is* valid when it lands. The
 * Sign out button still calls `logout()`, where revoking is the point.
 *
 * Skipped for {@link SESSION_ENDPOINT} itself — its own DELETE 401ing here
 * would recurse into another DELETE — for the probe, which needs its 401 to
 * come back untouched, and during SSR, where there is no client Firebase state
 * to tear down and no browser to navigate.
 */
export const invalidSessionInterceptor: HttpInterceptorFn = (req, next) => {
  if (
    req.url.includes(SESSION_ENDPOINT) ||
    req.context.get(BYPASS_SESSION_RECOVERY) ||
    !isPlatformBrowser(inject(PLATFORM_ID))
  ) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const probe = inject(SessionProbe);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        apiErrorCode(error) !== 'invalid-session'
      ) {
        return throwError(() => error);
      }

      // Captured before the sign-out, which can itself trigger navigation.
      const from_ = router.url;

      return from(probe.isLive()).pipe(
        switchMap((live) => {
          if (live) {
            // A newer session answered, so this 401 described one that no
            // longer applies. `next` is the downstream handler, not this
            // interceptor, so the retry cannot loop back through here.
            return next(req);
          }

          return from(auth.forgetSession().catch(() => undefined)).pipe(
            switchMap(() => {
              void router.navigateByUrl(loginUrlFor(router, from_));
              return throwError(() => error);
            }),
          );
        }),
      );
    }),
  );
};

/**
 * The sign-in URL, carrying the page the visitor was bounced off.
 *
 * Dropping it is what made re-authenticating feel like it had not worked:
 * somebody whose session expired on `/dashboard` was sent to a bare
 * `/auth/login`, signed in, and landed somewhere else entirely — with no sign
 * that anything had gone wrong and nothing to do but navigate back by hand.
 *
 * A URL travels here, never a page's data, and `safeRedirectTarget` on the
 * receiving side refuses anything that could leave the origin.
 *
 * Two origins get no parameter. An `/auth/…` page would only point the visitor
 * back at the page they are already on; `/` is the landing page, which is
 * where a signed-out visitor already belongs, and naming it would override the
 * sign-in page's own default of sending an authenticated visitor to their
 * workspace.
 */
function loginUrlFor(router: Router, from: string): UrlTree {
  const keep = from !== '/' && !from.startsWith('/auth/');

  return router.createUrlTree(['/auth/login'], {
    queryParams: keep ? { redirectTo: from } : {},
  });
}
