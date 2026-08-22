import { isPlatformBrowser } from '@angular/common';
import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { apiErrorCode } from '../events/event-api';
import { SESSION_ENDPOINT } from './auth-service';
import { BYPASS_SESSION_RECOVERY, SessionRecovery } from './session-recovery';

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
 * like it needed doing twice. So the decision belongs to {@link
 * SessionRecovery}, which re-asks with the current cookie: if a newer session
 * answers, the request is retried against it and nothing is signed out.
 * Retrying is safe because a 401 `invalid-session` is refused by the
 * authorization check, before any handler runs — there is no half-applied
 * write to worry about.
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

  const router = inject(Router);
  const recovery = inject(SessionRecovery);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        apiErrorCode(error) !== 'invalid-session'
      ) {
        return throwError(() => error);
      }

      // Read before the recovery runs, which navigates away on its way out.
      const from_ = router.url;

      return from(recovery.recover(from_)).pipe(
        switchMap((outcome) =>
          // `next` is the downstream handler, not this interceptor, so the
          // retry cannot loop back through here.
          outcome === 'retry' ? next(req) : throwError(() => error),
        ),
      );
    }),
  );
};
