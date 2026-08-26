import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meEndpoint } from '../dashboard/dashboard-api';
import { AuthService } from './auth-service';
import { BYPASS_SESSION_RECOVERY, SessionRecovery } from './session-recovery';

const ME = { user: { role: 'user' }, orgs: [] };
const UNAUTHORIZED = { error: true, data: { error: 'invalid-session' } };

describe('SessionRecovery', () => {
  let recovery: SessionRecovery;
  let http: HttpTestingController;
  let forgetSession: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let exchangeForSession: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    forgetSession = vi.fn().mockResolvedValue(undefined);
    logout = vi.fn().mockResolvedValue(undefined);
    // The default across this suite is a re-mint that cannot help — a browser
    // with no Firebase session behind the dead cookie. The tests that care
    // about the rescue override it.
    exchangeForSession = vi
      .fn()
      .mockRejectedValue(new Error('nobody is signed in'));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { forgetSession, logout, exchangeForSession },
        },
      ],
    });

    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    recovery = TestBed.inject(SessionRecovery);
    http = TestBed.inject(HttpTestingController);
  });

  function answerProbe(live: boolean): void {
    const request = http.expectOne(meEndpoint());
    if (live) {
      request.flush(ME);
    } else {
      request.flush(UNAUTHORIZED, {
        status: 401,
        statusText: 'Unauthorized',
      });
    }
  }

  it('asks the caller to retry when a newer session answers, and tears nothing down', async () => {
    const result = recovery.recover('/dashboard');
    answerProbe(true);

    await expect(result).resolves.toBe('retry');
    expect(forgetSession).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    // A live cookie needs no replacement, and minting one would cost a round
    // trip on the login path for nothing.
    expect(exchangeForSession).not.toHaveBeenCalled();
  });

  /**
   * The bug this whole path exists for: the cookie is gone but the browser is
   * still signed in. Sending that visitor to the sign-in page asks them to
   * redo what they did a minute ago, and because the second attempt lands a
   * cookie that sticks, it reads as "I had to sign in twice".
   */
  it('mints a replacement from the Firebase session rather than signing out', async () => {
    exchangeForSession.mockResolvedValue(undefined);

    const result = recovery.recover('/dashboard');
    answerProbe(false);

    await expect(result).resolves.toBe('retry');
    expect(exchangeForSession).toHaveBeenCalledTimes(1);
    expect(forgetSession).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  /**
   * The re-mint is a rescue, not a mechanism. It goes through the same
   * `POST /api/v1/auth/session` as sign-in, so a sign-in older than five
   * minutes is refused `stale-sign-in` and a revoked account is refused
   * outright — and both land here, at the sign-out that would have happened
   * anyway.
   */
  it('signs out when the replacement cannot be minted either', async () => {
    exchangeForSession.mockRejectedValue(new Error('stale-sign-in'));

    const result = recovery.recover('/dashboard');
    answerProbe(false);

    await expect(result).resolves.toBe('signed-out');
    expect(exchangeForSession).toHaveBeenCalledTimes(1);
    expect(forgetSession).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('signs out locally and redirects when the session really is gone', async () => {
    const result = recovery.recover('/dashboard/events');
    answerProbe(false);

    await expect(result).resolves.toBe('signed-out');
    expect(forgetSession).toHaveBeenCalledTimes(1);
    // Never `logout()`: its DELETE revokes whatever session is valid when it
    // lands, which need not be the one the 401 was about.
    expect(logout).not.toHaveBeenCalled();
    expect(String(navigateByUrl.mock.calls[0][0])).toBe(
      '/auth/login?redirectTo=%2Fdashboard%2Fevents',
    );
  });

  /**
   * The probe exists only to rule out "a newer session replaced this one". A
   * failure that proves nothing must leave the original 401 standing, so a
   * blip cannot be read as a live session and used to skip the sign-out.
   */
  it('treats a probe that cannot get a clean answer as a dead session', async () => {
    const serverError = recovery.recover('/dashboard');
    http
      .expectOne(meEndpoint())
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(serverError).resolves.toBe('signed-out');

    const offline = recovery.recover('/dashboard');
    http
      .expectOne(meEndpoint())
      .error(new ProgressEvent('error'), { status: 0 });
    await expect(offline).resolves.toBe('signed-out');
  });

  it('sends the bypass flag, so the interceptor leaves the probe alone', async () => {
    const result = recovery.recover('/dashboard');

    const request = http.expectOne(meEndpoint());
    expect(request.request.context.get(BYPASS_SESSION_RECOVERY)).toBe(true);
    expect(request.request.withCredentials).toBe(true);

    request.flush(ME);
    await result;
  });

  /**
   * The point of sharing the whole run rather than just the HTTP call: a page
   * load fires several requests at once, so one dead session produces several
   * 401s within a few milliseconds. Deduplicating only the probe would still
   * sign out three times and navigate three times.
   */
  it('runs once for concurrent callers: one probe, one sign-out, one navigation', async () => {
    const all = Promise.all([
      recovery.recover('/dashboard'),
      recovery.recover('/dashboard'),
      recovery.recover('/dashboard'),
    ]);

    answerProbe(false);

    await expect(all).resolves.toEqual([
      'signed-out',
      'signed-out',
      'signed-out',
    ]);
    expect(forgetSession).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    // One re-mint too: three concurrent exchanges would race to set the cookie
    // and revoke each other's work.
    expect(exchangeForSession).toHaveBeenCalledTimes(1);
    http.verify();
  });

  it('runs again once the previous run has finished', async () => {
    const first = recovery.recover('/dashboard');
    answerProbe(true);
    await expect(first).resolves.toBe('retry');

    const second = recovery.recover('/dashboard');
    answerProbe(false);
    await expect(second).resolves.toBe('signed-out');

    expect(forgetSession).toHaveBeenCalledTimes(1);
  });

  it('still redirects when the local sign-out itself fails', async () => {
    forgetSession.mockRejectedValue(new Error('storage unavailable'));

    const result = recovery.recover('/dashboard');
    answerProbe(false);

    await expect(result).resolves.toBe('signed-out');
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/', 'the landing page'],
    ['/auth/login', 'an auth page'],
  ])('omits redirectTo when the visitor came from %s', async (origin) => {
    const result = recovery.recover(origin);
    answerProbe(false);
    await result;

    expect(String(navigateByUrl.mock.calls[0][0])).toBe('/auth/login');
  });
});
