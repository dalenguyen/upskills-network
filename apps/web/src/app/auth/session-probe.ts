import {
  HttpClient,
  HttpContext,
  HttpContextToken,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { meEndpoint } from '../dashboard/dashboard-api';

/**
 * Marks a request that `invalidSessionInterceptor` must leave alone.
 *
 * Set on the probe below, whose whole job is to *collect* a 401 without the
 * interceptor treating it as a reason to sign anybody out.
 */
export const BYPASS_SESSION_RECOVERY = new HttpContextToken(() => false);

/**
 * Asks the server whether the session cookie authenticates *right now*.
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
 * shared state: if a newer sign-in landed, this succeeds.
 *
 * ## Only success rescinds the 401
 *
 * The original request already has a straight answer from the server, so this
 * exists solely to rule out "something newer replaced it". Absent proof of
 * that, the 401 stands. A probe that fails for any other reason — offline, a
 * 500, a timeout — is not evidence of a live session and must not be read as
 * one.
 *
 * ## `meEndpoint` rather than an endpoint of its own
 *
 * `GET /api/v1/auth/me` is the cheapest authenticated read in the app and the
 * one `AuthService` already points callers at for anything the client SDK
 * cannot answer. Its own 401 is what a probe needs; a dedicated route would be
 * a second thing to keep in step with the first.
 */
@Injectable({ providedIn: 'root' })
export class SessionProbe {
  private readonly http = inject(HttpClient);

  /**
   * The probe in flight, shared by everything that asks while it is running.
   *
   * A page load fires several requests at once, so one dead session produces
   * several 401s within a few milliseconds. Without this they would each probe,
   * each sign out, and each navigate — the answer is the same for all of them.
   */
  private inFlight: Promise<boolean> | null = null;

  /** Whether the session cookie is confirmed to authenticate right now. */
  isLive(): Promise<boolean> {
    if (this.inFlight === null) {
      const probe = this.ask();
      this.inFlight = probe;
      void probe.finally(() => {
        if (this.inFlight === probe) {
          this.inFlight = null;
        }
      });
    }

    return this.inFlight;
  }

  private async ask(): Promise<boolean> {
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
}
