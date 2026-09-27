import { Component } from '@angular/core';

/**
 * What sits where the registration form sits, once an event is over.
 *
 * The page itself stays up: guests follow links to it from their confirmation
 * emails, and search engines have indexed it. Only the call to action goes,
 * because there is nothing left to sign up for.
 */
@Component({
  selector: 'app-event-ended',
  template: `
    <section
      class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-indigo-950/5 sm:p-8"
    >
      <h2 class="text-lg font-bold tracking-tight text-zinc-900">
        This event has ended
      </h2>

      <p class="mt-2 text-sm text-zinc-600">
        Registration is closed. See what's coming up next.
      </p>

      <a
        href="/events"
        class="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        Browse upcoming events
      </a>
    </section>
  `,
})
export class EventEndedComponent {}
