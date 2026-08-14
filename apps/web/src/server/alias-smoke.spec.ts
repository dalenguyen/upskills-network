import { describe, expect, expectTypeOf, it } from 'vitest';

import type { SessionUser } from '@upskills/auth';
import { escapeHtml } from '@upskills/email';
import { getDb } from '@upskills/firestore';

/**
 * Alias resolution for the **server-only** libraries.
 *
 * These wrap the Firebase Admin SDK and Resend. They are imported by server
 * routes and by SSR page renders — never by code that reaches a browser — so
 * this spec lives under `src/server/` and runs in the `web-server` project's
 * node environment. Browser-safe libs are covered by
 * `src/app/pages/alias-smoke.spec.ts`.
 *
 * ## Why `@upskills/auth` is asserted at the type level only
 *
 * Importing it at runtime cannot work under Vitest today, and the cause is not
 * ours: `firebase-admin/auth` reaches `jwks-rsa`, which is CommonJS and does a
 * runtime `require('jose')` — and `jose` ships ES modules from a package marked
 * CommonJS. Node's CJS loader dies on the first `export`. Vite's transform does
 * not intercept it, so `server.deps.inline` does not help; it was tried in both
 * environments and against both package names.
 *
 * A type-only import still proves what this file exists to prove — that
 * `@upskills/auth` resolves through `tsconfig.base.json` paths — because the
 * `typecheck` target compiles this spec (see the lib `typecheck` targets, which
 * run `tsconfig.spec.json` as well as `tsconfig.lib.json`). What it does not
 * cover is Vite/Nx *runtime* path resolution for that one alias. The lib's own
 * 65 tests exercise the code itself; the gap is narrow and named rather than
 * papered over with config that does nothing.
 *
 * Worth revisiting when `jwks-rsa` ships ESM or `jose` fixes its packaging.
 */
describe('server-only workspace aliases', () => {
  it('resolves the auth lib types', () => {
    expectTypeOf<SessionUser['uid']>().toEqualTypeOf<string>();
    expectTypeOf<SessionUser['admin']>().toEqualTypeOf<boolean>();
  });

  it('resolves the email lib', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  // Resolution only — calling getDb() would initialise the Admin SDK against
  // no emulator and no credentials.
  it('resolves the firestore lib', () => {
    expect(typeof getDb).toBe('function');
  });
});
