import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpContext,
  HttpErrorResponse,
  HttpRequest,
  HttpResponse,
  type HttpHandlerFn,
} from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidSessionInterceptor } from './invalid-session-interceptor';
import { AuthService, SESSION_ENDPOINT } from './auth-service';
import { BYPASS_SESSION_RECOVERY, SessionProbe } from './session-probe';

describe('invalidSessionInterceptor', () => {
  const req = new HttpRequest('GET', '/api/v1/auth/me');
  let forgetSession: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let isLive: ReturnType<typeof vi.fn>;

  /**
   * `sessionLive` is what the probe finds when it re-asks with the current
   * cookie. `false` — the session really is gone — is the ordinary case; `true`
   * means something newer replaced the session this request's 401 was about.
   */
  function configure(
    platform: 'browser' | 'server',
    sessionLive = false,
  ): void {
    forgetSession = vi.fn().mockResolvedValue(undefined);
    logout = vi.fn().mockResolvedValue(undefined);
    isLive = vi.fn().mockResolvedValue(sessionLive);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AuthService, useValue: { forgetSession, logout } },
        { provide: SessionProbe, useValue: { isLive } },
      ],
    });
  }

  function run(request: HttpRequest<unknown>, next: HttpHandlerFn) {
    return TestBed.runInInjectionContext(() =>
      firstValueFrom(invalidSessionInterceptor(request, next)),
    );
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('signs out and redirects to login on a 401 invalid-session', async () => {
    configure('browser');
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/dashboard/events');
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);

    expect(forgetSession).toHaveBeenCalledTimes(1);
    // Never `logout()`: its DELETE revokes whatever session is valid when it
    // lands, which need not be the one this 401 was about.
    expect(logout).not.toHaveBeenCalled();
    // The destination rides along, so signing in again lands the visitor back
    // where they were bounced from rather than on the landing page.
    expect(String(navigateByUrl.mock.calls[0][0])).toBe(
      '/auth/login?redirectTo=%2Fdashboard%2Fevents',
    );
  });

  it('still redirects when the local sign-out itself fails', async () => {
    configure('browser');
    forgetSession.mockRejectedValue(new Error('local sign-out failed'));
    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(String(navigateByUrl.mock.calls[0][0])).toContain('/auth/login');
  });

  it('omits redirectTo when the visitor was already on a public page', async () => {
    configure('browser');
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/');
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(String(navigateByUrl.mock.calls[0][0])).toBe('/auth/login');
  });

  it('does not point redirectTo back at an auth page', async () => {
    configure('browser');
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/auth/login');
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(String(navigateByUrl.mock.calls[0][0])).toBe('/auth/login');
  });

  it('passes through a 401 that is not invalid-session', async () => {
    configure('browser');
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl');

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'stale-sign-in' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);

    expect(forgetSession).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('passes through a non-401 failure untouched', async () => {
    configure('browser');
    const error = new HttpErrorResponse({ status: 500 });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(forgetSession).not.toHaveBeenCalled();
  });

  it('never signs anybody out on a successful response', async () => {
    configure('browser');
    const next: HttpHandlerFn = () => of(new HttpResponse({ status: 200 }));

    await run(req, next);
    expect(forgetSession).not.toHaveBeenCalled();
  });

  it('skips the session endpoint itself, even on a 401 invalid-session', async () => {
    configure('browser');
    const sessionReq = new HttpRequest('DELETE', SESSION_ENDPOINT);
    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(sessionReq, next)).rejects.toBe(error);
    expect(forgetSession).not.toHaveBeenCalled();
  });

  it('retries against the newer session instead of signing out, when the probe finds one live', async () => {
    // The tab-left-open case. This request's cookie was replaced between the
    // request leaving and its 401 coming back, so the 401 describes a session
    // that no longer applies. Tearing down here would destroy the replacement.
    configure('browser', true);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const ok = new HttpResponse({ status: 200 });

    let attempts = 0;
    const next: HttpHandlerFn = () => {
      attempts += 1;
      return attempts === 1 ? throwError(() => error) : of(ok);
    };

    await expect(run(req, next)).resolves.toBe(ok);

    expect(attempts).toBe(2);
    expect(forgetSession).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('leaves the probe request itself alone, so its 401 comes back untouched', async () => {
    // Without this the probe's own 401 would be intercepted, and it would send
    // a second probe to decide what to do about the first.
    configure('browser');
    const probeReq = new HttpRequest('GET', '/api/v1/auth/me', {
      context: new HttpContext().set(BYPASS_SESSION_RECOVERY, true),
    });
    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(probeReq, next)).rejects.toBe(error);

    expect(isLive).not.toHaveBeenCalled();
    expect(forgetSession).not.toHaveBeenCalled();
  });

  it('has no opinion during server-side rendering', async () => {
    configure('server');
    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(forgetSession).not.toHaveBeenCalled();
  });
});
