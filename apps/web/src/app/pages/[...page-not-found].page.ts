import { Component, OnInit, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { LandingFooterComponent } from '../landing/landing-footer.component';
import { LandingHeaderComponent } from '../landing/landing-header.component';

/**
 * The catch-all route: anything the file-based router cannot match renders here.
 *
 * Without it, an unmatched URL makes the router throw `NG04002` during the
 * initial navigation and the app renders nothing at all — a white page with an
 * error only visible in the console. A mistyped or stale link is a normal thing
 * for a visitor to do, and it should look like a page, not like an outage.
 *
 * The response status is still 200. Analog renders this page through the same
 * SSR handler as every other route, and there is no supported way to set the
 * status from inside the component; making it a true 404 means a Nitro-level
 * handler. Worth doing if search engines start indexing dead URLs, not worth
 * the extra moving part before then.
 */
@Component({
  selector: 'app-page-not-found',
  imports: [LandingHeaderComponent, LandingFooterComponent],
  template: `
    <app-landing-header />

    <main class="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div class="mx-auto max-w-lg py-12 text-center">
        <p
          class="text-sm font-semibold uppercase tracking-wider text-indigo-600"
        >
          404
        </p>
        <h1 class="mt-3 text-2xl font-bold tracking-tight text-zinc-900">
          We couldn't find that page
        </h1>
        <p class="mt-3 text-zinc-600">
          The link may be out of date, or the address may have a typo in it.
        </p>
        <a
          href="/"
          class="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Back to Upskills
        </a>
      </div>
    </main>

    <app-landing-footer />
  `,
})
export default class PageNotFoundComponent implements OnInit {
  private readonly title = inject(Title);

  ngOnInit(): void {
    this.title.setTitle('Page not found · Upskills');
  }
}
