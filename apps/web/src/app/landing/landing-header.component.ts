import { Component } from '@angular/core';

/**
 * The site header, shared by the landing page, the auth pages, and event pages.
 *
 * "Sign in" sits outside the `md:flex` nav on purpose: the section links are a
 * landing-page convenience and collapse on small screens, but reaching sign-in
 * is the one thing a returning visitor cannot do any other way — the header is
 * the only place in the app that links to it, so it has to survive the mobile
 * breakpoint.
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
          <a
            href="/auth/login"
            class="whitespace-nowrap text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Sign in
          </a>

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
export class LandingHeaderComponent {}
