import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
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

describe('invalidSessionInterceptor', () => {
  const req = new HttpRequest('GET', '/api/v1/auth/me');
  let logout: ReturnType<typeof vi.fn>;

  function configure(platform: 'browser' | 'server'): void {
    logout = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AuthService, useValue: { logout } },
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

    expect(logout).toHaveBeenCalledTimes(1);
    // The destination rides along, so signing in again lands the visitor back
    // where they were bounced from rather than on the landing page.
    expect(String(navigateByUrl.mock.calls[0][0])).toBe(
      '/auth/login?redirectTo=%2Fdashboard%2Fevents',
    );
  });

  it('still redirects when logout itself fails', async () => {
    configure('browser');
    logout.mockRejectedValue(new Error('server session teardown failed'));
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

    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('passes through a non-401 failure untouched', async () => {
    configure('browser');
    const error = new HttpErrorResponse({ status: 500 });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(logout).not.toHaveBeenCalled();
  });

  it('never calls logout on a successful response', async () => {
    configure('browser');
    const next: HttpHandlerFn = () => of(new HttpResponse({ status: 200 }));

    await run(req, next);
    expect(logout).not.toHaveBeenCalled();
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
    expect(logout).not.toHaveBeenCalled();
  });

  it('has no opinion during server-side rendering', async () => {
    configure('server');
    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(logout).not.toHaveBeenCalled();
  });
});
