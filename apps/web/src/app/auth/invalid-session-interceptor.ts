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

/**
 * On a 401 `invalid-session` from any API call, sign out locally and send the
 * visitor to `/auth/login` instead of leaving every guarded page to render its
 * own "Something went wrong" for a session that is simply gone.
 *
 * Skipped for {@link SESSION_ENDPOINT} itself — its own DELETE 401ing here
 * would recurse into another DELETE — and during SSR, where there is no
 * client Firebase state to tear down and no browser to navigate.
 */
export const invalidSessionInterceptor: HttpInterceptorFn = (req, next) => {
  if (
    req.url.includes(SESSION_ENDPOINT) ||
    !isPlatformBrowser(inject(PLATFORM_ID))
  ) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);

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

      return from(auth.logout().catch(() => undefined)).pipe(
        switchMap(() => {
          void router.navigateByUrl(loginUrlFor(router, from_));
          return throwError(() => error);
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
