import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
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

      return from(auth.logout().catch(() => undefined)).pipe(
        switchMap(() => {
          void router.navigateByUrl('/auth/login');
          return throwError(() => error);
        }),
      );
    }),
  );
};
