import {
  HttpClient,
  HttpContext,
  HttpContextToken,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth-service';
import { meEndpoint } from '../dashboard/dashboard-api';

/**
 * Marks a request that `invalidSessionInterceptor` must leave alone.
 *
 * Set on the probe below, whose whole job is to *collect* a 401 without the
 * interceptor treating it as a reason to sign anybody out.
 */
export const BYPASS_SESSION_RECOVERY = new HttpContextToken(() => false);

/** What a caller should do with the request whose 401 started the recovery. */
export type Recovery =
  /** A newer session answered — send the request again, against that one. */
  | 'retry'
  /** The session really is gone. The browser is signed out and navigating. */
  | 'signed-out';

/**
 * Decides what a 401 `invalid-session` actually means, and acts on it once.
 *
 * ## Why a 401 is not enough on its own
 *
 * A 401 says the cookie that request carried was no good. It does not say the
 * browser has no session, because the cookie is shared by every tab on the
 * origin and can be replaced between a request leaving and its answer coming
 * back. A request issued from a tab left open over lunch, answered after the
 * visitor signed in again in another tab, reports a session that has already
 * been replaced by a working one.
 *
 * Acting on that stale answer is what made signing in feel like it had to be
 * done twice: the recovery path tore down the *fresh* session — clearing the
 * cookie and revoking the account's refresh tokens — on behalf of a request
 * that predated it.
 *
 * Re-asking with the current cookie settles it, because the cookie is the
 * shared state: if a newer sign-in landed, the probe succeeds.
 *
 * ## Only success rescinds the 401
 *
 * The original request already has a straight answer from the server, so the
 * probe exists solely to rule out "something newer replaced it". Absent proof
 * of that, the 401 stands. A probe that fails for any other reason — offline, a
 * 500, a timeout — is not evidence of a live session and must not be read as
 * one.
 *
 * ## One recovery, however many 401s
 *
 * A page load fires several requests at once, so one dead session produces
 * several 401s within a few milliseconds. They share a single run: one probe,
 * one sign-out, one navigation. Deduplicating only the probe would leave the
 * sign-out and the navigation to happen once per failed request — which is why
 * the whole sequence lives behind {@link inFlight}, not just the HTTP call.
 *
 * ## `meEndpoint` rather than an endpoint of its own
 *
 * `GET /api/v1/auth/me` is the cheapest authenticated read in the app and the
 * one `AuthService` already points callers at for anything the client SDK
 * cannot answer. Its own 401 is what a probe needs; a dedicated route would be
 * a second thing to keep in step with the first.
 */
@Injectable({ providedIn: 'root' })
export class SessionRecovery {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** The run in flight, shared by every 401 that arrives while it lasts. */
  private inFlight: Promise<Recovery> | null = null;

  /**
   * Settle what a 401 meant, tearing the session down if it really is gone.
   *
   * `from` is the page the visitor was on, carried into the sign-in URL so
   * they can be returned to it. Concurrent callers are all on that same page,
   * so the first one's value is the right one for the shared run.
   */
  recover(from: string): Promise<Recovery> {
    if (this.inFlight === null) {
      const run = this.run(from);
      this.inFlight = run;
      void run.finally(() => {
        if (this.inFlight === run) {
          this.inFlight = null;
        }
      });
    }

    return this.inFlight;
  }

  private async run(from: string): Promise<Recovery> {
    if (await this.sessionIsLive()) {
      return 'retry';
    }

    // Best-effort: a browser that cannot clear its own local state is still
    // better off at the sign-in page than sitting on a page it cannot load.
    await this.auth.forgetSession().catch(() => undefined);
    void this.router.navigateByUrl(this.loginUrlFor(from));

    return 'signed-out';
  }

  private async sessionIsLive(): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.get(meEndpoint(), {
          withCredentials: true,
          context: new HttpContext().set(BYPASS_SESSION_RECOVERY, true),
        }),
      );
      return true;
    } catch {
      // See the class comment: anything other than a clean answer leaves the
      // original 401 standing.
      return false;
    }
  }

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
   * Two origins get no parameter. An `/auth/…` page would only point the
   * visitor back at the page they are already on; `/` is the landing page,
   * which is where a signed-out visitor already belongs, and naming it would
   * override the sign-in page's own default of sending an authenticated
   * visitor to their workspace.
   */
  private loginUrlFor(from: string): UrlTree {
    const keep = from !== '/' && !from.startsWith('/auth/');

    return this.router.createUrlTree(['/auth/login'], {
      queryParams: keep ? { redirectTo: from } : {},
    });
  }
}
