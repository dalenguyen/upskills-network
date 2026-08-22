import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, UrlTree } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService, type AuthUser } from './auth-service';
import { guestGuard } from './guest-guard';

/**
 * The mirror of `authGuard`, and like it a redirect rather than an
 * authorization decision. What is worth pinning down is that it keeps a
 * signed-in visitor off the sign-in form — showing it to them is what made the
 * app ask for a second sign-in — without bouncing anybody it should not.
 */
describe('guestGuard', () => {
  const signedIn: AuthUser = {
    uid: 'uid-1',
    email: 'someone@example.com',
    displayName: null,
    emailVerified: true,
  };

  const state = { url: '/auth/login' } as RouterStateSnapshot;

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

  function run(redirectTo?: string): Promise<boolean | UrlTree> {
    const route = {
      queryParamMap: convertToParamMap(
        redirectTo === undefined ? {} : { redirectTo },
      ),
    } as ActivatedRouteSnapshot;

    return Promise.resolve(
      TestBed.runInInjectionContext(() => guestGuard(route, state)),
    ) as Promise<boolean | UrlTree>;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('lets a signed-out visitor reach the sign-in page', async () => {
    configure('browser', null);
    await expect(run()).resolves.toBe(true);
  });

  it('sends a signed-in visitor to the dashboard rather than a sign-in form', async () => {
    configure('browser', signedIn);
    const result = await run();

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/dashboard');
  });

  it('sends a signed-in visitor where they were originally headed', async () => {
    configure('browser', signedIn);
    const result = await run('/dashboard/events');

    expect(String(result)).toBe('/dashboard/events');
  });

  it('keeps the query string on the destination', async () => {
    configure('browser', signedIn);
    const result = await run('/dashboard/events?status=draft');

    expect(String(result)).toBe('/dashboard/events?status=draft');
  });

  it('refuses a redirectTo that could leave the origin', async () => {
    configure('browser', signedIn);

    await expect(String(await run('//evil.example.com'))).toBe('/dashboard');
    await expect(String(await run('https://evil.example.com'))).toBe(
      '/dashboard',
    );
  });

  /**
   * Honouring this would redirect to a route that runs this same guard and
   * redirects again, until the router gives up with an error instead of a page.
   */
  it('refuses a redirectTo pointing back at an auth page', async () => {
    configure('browser', signedIn);

    expect(String(await run('/auth/login'))).toBe('/dashboard');
    expect(String(await run('/auth/register'))).toBe('/dashboard');
  });

  /**
   * Same reasoning as `authGuard`: during SSR there is no client SDK, so the
   * guard would see `null` for everybody. It must not form an opinion there.
   */
  it('has no opinion during server-side rendering', async () => {
    configure('server', signedIn);
    await expect(run()).resolves.toBe(true);
  });
});
