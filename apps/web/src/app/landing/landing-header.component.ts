import { HttpClient } from '@angular/common/http';
import { Component, HostListener, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../auth/auth-service';
import { meEndpoint, type MeGetResponse } from '../dashboard/dashboard-api';

/**
 * The site header, shared by the landing page, the auth pages, and event pages.
 *
 * On mobile every nav item — the section links, Events, Admin, sign in/out,
 * and the Dashboard CTA — lives behind the hamburger menu, so the always-
 * visible top row is just the wordmark and the toggle. Desktop keeps the
 * `md:flex` nav plus sign-in/sign-out and the CTA inline.
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
        class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:gap-6 sm:px-6 lg:px-8"
      >
        <a href="/" class="flex items-center gap-2.5" aria-label="Upskills">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30"
            aria-hidden="true"
          >
            U
          </span>
          <span
            class="hidden text-lg font-bold tracking-tight text-zinc-900 sm:inline"
          >
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
          <a href="/events" class="transition-colors hover:text-zinc-900">
            Events
          </a>
          @if (isPlatformAdmin()) {
            <a href="/admin/orgs" class="transition-colors hover:text-zinc-900">
              Admin
            </a>
          }
        </nav>

        <div class="flex items-center gap-3 sm:gap-5">
          <div class="hidden items-center gap-3 sm:gap-5 md:flex">
            @if (auth.user(); as user) {
              <span
                class="hidden whitespace-nowrap text-sm font-medium text-zinc-600 sm:inline"
              >
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
              <a
                href="/dashboard"
                class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition duration-150 hover:bg-indigo-500 hover:shadow-md hover:shadow-indigo-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Dashboard
              </a>
            } @else {
              <a
                href="/auth/login"
                class="whitespace-nowrap text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
              >
                Sign in
              </a>
            }
          </div>

          <div class="relative md:hidden">
            <button
              type="button"
              (click)="toggleMenu()"
              [attr.aria-expanded]="menuOpen() ? 'true' : 'false'"
              aria-controls="mobile-menu"
              aria-label="Menu"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <svg
                class="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <div
              id="mobile-menu"
              [hidden]="!menuOpen()"
              class="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-900/5 bg-white py-1 shadow-lg shadow-zinc-900/10"
            >
              <a
                href="/#how-it-works"
                (click)="closeMenu()"
                class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                How it works
              </a>
              <a
                href="/#features"
                (click)="closeMenu()"
                class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                Why Upskills
              </a>
              <a
                href="/events"
                class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                Events
              </a>
              @if (isPlatformAdmin()) {
                <a
                  href="/admin/orgs"
                  class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  Admin
                </a>
              }

              <div class="my-1 border-t border-zinc-900/5"></div>

              @if (auth.user(); as user) {
                <span
                  class="block truncate px-4 py-1 text-xs font-medium text-zinc-400"
                >
                  {{ user.displayName ?? user.email ?? 'Account' }}
                </span>
                <a
                  href="/dashboard"
                  class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  Dashboard
                </a>
                <button
                  type="button"
                  [disabled]="signingOut()"
                  (click)="signOut()"
                  class="block w-full px-4 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Sign out
                </button>
              } @else {
                <a
                  href="/auth/login"
                  class="block px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  Sign in
                </a>
              }
            </div>
          </div>
        </div>
      </div>
    </header>
  `,
})
export class LandingHeaderComponent {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  /**
   * Whether the signed-in user is a platform admin.
   *
   * The Firebase user object in {@link AuthService} deliberately carries no
   * role — see `auth-service.ts`, which points anything needing the platform
   * role at `GET /api/v1/auth/me`. The header is shared by every page, so it
   * asks the endpoint itself and defaults to `false` (hidden) on any failure.
   */
  readonly isPlatformAdmin = signal(false);

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

  /**
   * Whether the small-screen overflow menu is open. Like {@link signingOut},
   * this is a signal because the component runs zoneless and toggling it must
   * schedule its own repaint.
   */
  readonly menuOpen = signal(false);

  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.user() === null) {
        this.isPlatformAdmin.set(false);
        return;
      }

      void this.refreshPlatformRole();
    });
  }

  toggleMenu(): void {
    this.menuOpen.set(!this.menuOpen());
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * A document-level listener rather than a template `(keydown.escape)` on
   * `#mobile-menu`: focus can be on the toggle button or on any link inside
   * the menu, and a handler scoped to one element would miss Escape from the
   * other. This also sidesteps making a plain wrapper `div` focusable just to
   * host a keydown handler.
   */
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    this.closeMenu();
  }

  private async refreshPlatformRole(): Promise<void> {
    try {
      const me = await firstValueFrom(
        this.http.get<MeGetResponse>(meEndpoint(), { withCredentials: true }),
      );
      // Re-checked after the await: a sign-out during the request already set
      // this to false, and a late answer must not put the link back.
      this.isPlatformAdmin.set(
        this.auth.user() !== null && me.user.role === 'admin',
      );
    } catch {
      // Signed out on the server (stale or missing cookie), or the request
      // failed. Least privilege: keep the admin link hidden.
      this.isPlatformAdmin.set(false);
    }
  }

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
