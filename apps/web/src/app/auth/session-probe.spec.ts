import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { meEndpoint } from '../dashboard/dashboard-api';
import { BYPASS_SESSION_RECOVERY, SessionProbe } from './session-probe';

describe('SessionProbe', () => {
  let probe: SessionProbe;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([])),
        provideHttpClientTesting(),
      ],
    });

    probe = TestBed.inject(SessionProbe);
    http = TestBed.inject(HttpTestingController);
  });

  it('reports a live session when the endpoint answers', async () => {
    const result = probe.isLive();

    http.expectOne(meEndpoint()).flush({ user: { role: 'user' }, orgs: [] });

    await expect(result).resolves.toBe(true);
  });

  it('reports a dead session on a 401', async () => {
    const result = probe.isLive();

    http
      .expectOne(meEndpoint())
      .flush(
        { error: true, data: { error: 'invalid-session' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(result).resolves.toBe(false);
  });

  /**
   * The probe exists only to rule out "a newer session replaced this one". A
   * failure that proves nothing must leave the original 401 standing, so a
   * blip cannot be read as a live session and used to skip the sign-out.
   */
  it('reports a dead session when the probe cannot get a clean answer', async () => {
    const serverError = probe.isLive();
    http
      .expectOne(meEndpoint())
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(serverError).resolves.toBe(false);

    const offline = probe.isLive();
    http
      .expectOne(meEndpoint())
      .error(new ProgressEvent('error'), { status: 0 });
    await expect(offline).resolves.toBe(false);
  });

  it('sends the bypass flag, so the interceptor leaves the probe alone', async () => {
    const result = probe.isLive();

    const request = http.expectOne(meEndpoint());
    expect(request.request.context.get(BYPASS_SESSION_RECOVERY)).toBe(true);
    expect(request.request.withCredentials).toBe(true);

    request.flush({ user: { role: 'user' }, orgs: [] });
    await result;
  });

  /**
   * A page load fires several requests at once, so one dead session produces
   * several 401s within a few milliseconds. They all want the same answer.
   */
  it('shares one request between callers that ask while it is in flight', async () => {
    const first = probe.isLive();
    const second = probe.isLive();
    const third = probe.isLive();

    http.expectOne(meEndpoint()).flush({ user: { role: 'user' }, orgs: [] });

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      true,
      true,
      true,
    ]);
    http.verify();
  });

  it('asks again once the previous answer has landed', async () => {
    const first = probe.isLive();
    http.expectOne(meEndpoint()).flush({ user: { role: 'user' }, orgs: [] });
    await expect(first).resolves.toBe(true);

    const second = probe.isLive();
    http
      .expectOne(meEndpoint())
      .flush(
        { error: true, data: { error: 'invalid-session' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await expect(second).resolves.toBe(false);
  });
});
