import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { routeMeta } from './login.page';

@Component({ selector: 'app-login-stub', template: '' })
class LoginStubComponent {}

/**
 * Analog compiles a `.page.ts` into a parent route carrying the file's path
 * segment, whose only child is a path-less route holding the `routeMeta`. The
 * config under test is rebuilt in that exact shape here, because the thing
 * worth checking is that the redirect actually fires against a real router —
 * asserting `routeMeta.redirectTo === '/auth/login'` would just restate the
 * source and would still pass with a `pathMatch` that never matches.
 */
const routes: Routes = [
  { path: 'login', children: [{ path: '', ...routeMeta }] },
  { path: 'auth/login', component: LoginStubComponent },
];

describe('the /login alias', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('redirects to the sign-in page', async () => {
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/login');

    expect(router.url).toBe('/auth/login');
  });

  it('resolves the redirect target, so the alias cannot rot silently', async () => {
    const router = TestBed.inject(Router);

    const navigated = await router.navigateByUrl('/login');

    expect(navigated).toBe(true);
  });
});
