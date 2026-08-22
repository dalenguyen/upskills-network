import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpContext,
  HttpErrorResponse,
  HttpRequest,
  HttpResponse,
  type HttpHandlerFn,
} from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidSessionInterceptor } from './invalid-session-interceptor';
import { SESSION_ENDPOINT } from './auth-service';
import {
  BYPASS_SESSION_RECOVERY,
  SessionRecovery,
  type Recovery,
} from './session-recovery';

/**
 * What this interceptor decides is narrow: which failures are a session
 * problem at all, and what to do with the request once `SessionRecovery` has
 * said what the 401 meant. The sign-out and the redirect belong to that
 * service and are tested with it.
 */
describe('invalidSessionInterceptor', () => {
  const req = new HttpRequest('GET', '/api/v1/auth/me');
  let recover: ReturnType<typeof vi.fn>;

  const invalidSession = () =>
    new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'invalid-session' } },
    });

  function configure(
    platform: 'browser' | 'server',
    outcome: Recovery = 'signed-out',
  ): void {
    recover = vi.fn().mockResolvedValue(outcome);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: SessionRecovery, useValue: { recover } },
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

  it('hands a 401 invalid-session to the recovery, with the page to return to', async () => {
    configure('browser');
    const error = invalidSession();
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(typeof recover.mock.calls[0][0]).toBe('string');
  });

  it('retries against the newer session when the recovery finds one', async () => {
    // The tab-left-open case. This request's cookie was replaced between the
    // request leaving and its 401 coming back, so the 401 describes a session
    // that no longer applies.
    configure('browser', 'retry');
    const ok = new HttpResponse({ status: 200 });

    let attempts = 0;
    const next: HttpHandlerFn = () => {
      attempts += 1;
      return attempts === 1 ? throwError(() => invalidSession()) : of(ok);
    };

    await expect(run(req, next)).resolves.toBe(ok);
    expect(attempts).toBe(2);
  });

  it('rethrows once the recovery has signed the browser out', async () => {
    configure('browser', 'signed-out');
    const error = invalidSession();

    let attempts = 0;
    const next: HttpHandlerFn = () => {
      attempts += 1;
      return throwError(() => error);
    };

    await expect(run(req, next)).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it('leaves the probe request itself alone, so its 401 comes back untouched', async () => {
    // Without this the probe's own 401 would be intercepted, and it would send
    // a second probe to decide what to do about the first.
    configure('browser');
    const probeReq = new HttpRequest('GET', '/api/v1/auth/me', {
      context: new HttpContext().set(BYPASS_SESSION_RECOVERY, true),
    });
    const error = invalidSession();
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(probeReq, next)).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it('passes through a 401 that is not invalid-session', async () => {
    configure('browser');
    const error = new HttpErrorResponse({
      status: 401,
      error: { error: true, data: { error: 'stale-sign-in' } },
    });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it('passes through a non-401 failure untouched', async () => {
    configure('browser');
    const error = new HttpErrorResponse({ status: 500 });
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it('never starts a recovery on a successful response', async () => {
    configure('browser');
    const next: HttpHandlerFn = () => of(new HttpResponse({ status: 200 }));

    await run(req, next);
    expect(recover).not.toHaveBeenCalled();
  });

  it('skips the session endpoint itself, even on a 401 invalid-session', async () => {
    configure('browser');
    const sessionReq = new HttpRequest('DELETE', SESSION_ENDPOINT);
    const error = invalidSession();
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(sessionReq, next)).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it('has no opinion during server-side rendering', async () => {
    configure('server');
    const error = invalidSession();
    const next: HttpHandlerFn = () => throwError(() => error);

    await expect(run(req, next)).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });
});
