import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../auth/auth-service';

/**
 * The site header, shared by the landing page, the auth pages, and event pages.
 *
 * "Sign in" sits outside the `md:flex` nav on purpose: the section links are a
 * landing-page convenience and collapse on small screens, but reaching sign-in
 * is the one thing a returning visitor cannot do any other way — the header is
 * the only place in the app that links to it, so it has to survive the mobile
 * breakpoint. The signed-in controls live in the same spot, so signing out
 * never collapses behind the small-screen nav either.
 *
 * Every link here is a plain `href` rather than a `routerLink`, matching the
 * rest of the header. The section links are same-page fragments that must work
 * from other routes, and a full navigation to `/auth/login` costs one document
 * load on a page a visitor reaches at most once per session.
 */
@Component({
  selector: 'app-landing-header',
  imports: [],
  template: `
    <header
      class="sticky top-0 z-40 border-b border-zinc-900/5 bg-white/75 backdrop-blur-md"
    >
      <div
        class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8"
      >
        <a href="/" class="flex items-center gap-2.5">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30"
            aria-hidden="true"
          >
            U
          </span>
          <span class="text-lg font-bold tracking-tight text-zinc-900">
            Upskills
          </span>
        </a>

        <nav
          class="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex"
          aria-label="Primary"
        >
          <a
            href="/#how-it-works"
            class="transition-colors hover:text-zinc-900"
          >
            How it works
          </a>
          <a href="/#features" class="transition-colors hover:text-zinc-900">
            Why Upskills
          </a>
        </nav>

        <div class="flex items-center gap-4 sm:gap-5">
          @if (auth.user(); as user) {
            <span class="whitespace-nowrap text-sm font-medium text-zinc-600">
              {{ user.displayName ?? user.email ?? 'Account' }}
            </span>
            <button
              type="button"
              [disabled]="signingOut()"
              (click)="signOut()"
              class="whitespace-nowrap text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign out
            </button>
          } @else {
            <a
              href="/auth/login"
              class="whitespace-nowrap text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
            >
              Sign in
            </a>
          }

          <a
            href="/#waitlist"
            class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition duration-150 hover:bg-indigo-500 hover:shadow-md hover:shadow-indigo-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </header>
  `,
})
export class LandingHeaderComponent {
  readonly auth = inject(AuthService);

  /**
   * A signal rather than a plain field. This app is zoneless — `zone.js` is not
   * a dependency and nothing provides `NgZone` — so the only reason a mutated
   * field would repaint here is that Angular runs change detection after a
   * template listener returns, which happens to cover the synchronous write
   * below. A signal does not lean on that: it schedules the repaint itself,
   * from anywhere. This also matches `login.page.ts`, which tracks its own
   * in-flight state as a signal.
   */
  readonly signingOut = signal(false);

  private readonly router = inject(Router);

  async signOut(): Promise<void> {
    if (this.signingOut()) {
      return;
    }

    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch (error) {
      // `logout()` signs the browser out before it can reject, so the visitor
      // is locally signed out either way and the navigation below still
      // happens. What failed is the server-side teardown: the `__session`
      // cookie and the refresh tokens outlive this tab until they expire,
      // which is a real difference on a shared machine. The header is the
      // wrong surface for an error state — it is one line in a sticky bar on
      // every page — but this must not vanish silently, so it goes to the
      // console until there is somewhere better to put it.
      console.error(
        'Signed out locally, but the server session could not be torn down.',
        error,
      );
    } finally {
      this.signingOut.set(false);
    }

    await this.router.navigateByUrl('/');
  }
}
