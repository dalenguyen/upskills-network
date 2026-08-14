import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { authGuard } from './auth-guard';
import { AuthService, type AuthUser } from './auth-service';

/**
 * These tests describe a redirect, not an authorization decision. The guard is
 * UX only; see its doc comment. What is worth pinning down is that it does not
 * bounce people it should not: a signed-in user restoring a session, and any
 * server-side render.
 */
describe('authGuard', () => {
  const signedIn: AuthUser = {
    uid: 'uid-1',
    email: 'someone@example.com',
    displayName: null,
    emailVerified: true,
  };

  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/dashboard/events' } as RouterStateSnapshot;

  function configure(platform: string, user: AuthUser | null): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: AuthService,
          useValue: { currentUser: async () => user },
        },
      ],
    });
  }

  function run(): Promise<boolean | UrlTree> {
    return Promise.resolve(
      TestBed.runInInjectionContext(() => authGuard(route, state)),
    ) as Promise<boolean | UrlTree>;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('lets a signed-in visitor through', async () => {
    configure('browser', signedIn);
    await expect(run()).resolves.toBe(true);
  });

  it('redirects a signed-out visitor to the login page, keeping where they were headed', async () => {
    configure('browser', null);
    const result = await run();

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe(
      '/auth/login?redirectTo=%2Fdashboard%2Fevents',
    );
  });

  /**
   * The one that matters. During SSR there is no client SDK, so the guard would
   * see `null` for every visitor — including those holding a perfectly valid
   * `__session` cookie — and redirect the lot to the login page. It has no
   * opinion on the server; the page's own server-side data load decides.
   */
  it('has no opinion during server-side rendering', async () => {
    configure('server', null);
    await expect(run()).resolves.toBe(true);
  });
});
