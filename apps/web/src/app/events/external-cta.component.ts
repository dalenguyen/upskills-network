import { Component, computed, input } from '@angular/core';
import { Icon } from '@upskills/ui';

import type { PublicEvent } from './event-api';

/**
 * What sits where the registration form sits, for an event Upskills only lists.
 *
 * ## Why there is no form here at all
 *
 * A community event is run by an organizer who is not on this platform. The
 * only registration that means anything is the one on their page — a form here
 * would create a guest document, a cancel token, and a confirmation email for a
 * seat nobody outside Upskills knows about, and the guest would arrive to find
 * they were never on the list. `reserveSpot` refuses these outright; this panel
 * is the honest version of that refusal, offered before anyone types a name
 * rather than after.
 *
 * ## Why the source is named twice
 *
 * Once in the heading, once in the button. A visitor is about to leave the site
 * for a domain they did not choose, and the least surprising way to do that is
 * to say whose site it is before the click rather than let them discover it in
 * the address bar. When the source is unknown the copy degrades to "the
 * organizer's site" — vaguer, but never wrong.
 *
 * `rel="noopener noreferrer"` is the security part: `noopener` denies the
 * opened page a handle on this one, which is what stops a third-party listing
 * from navigating the tab it came from. `nofollow` is the SEO part — these are
 * links to other people's events, not endorsements this site is staking its
 * ranking on.
 */
@Component({
  selector: 'app-external-cta',
  imports: [Icon],
  template: `
    <section
      class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-indigo-950/5 sm:p-8"
    >
      <h2 class="text-lg font-bold tracking-tight text-zinc-900">
        Registration is on {{ sourceLabel() }}
      </h2>

      <p class="mt-2 text-sm text-zinc-600">
        We list this event because it's worth knowing about. It's run by someone
        else, so signing up happens on their page — not here.
      </p>

      <a
        [href]="event().externalUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {{ buttonLabel() }}
        <ui-icon name="external-link" size="sm" />
      </a>

      <p class="mt-4 text-xs text-zinc-500">
        Opens in a new tab. Upskills doesn't take your registration, hold your
        spot, or handle payment for this event.
      </p>
    </section>
  `,
})
export class ExternalCtaComponent {
  readonly event = input.required<PublicEvent>();

  /** The source's name, or a truthful stand-in when it has none. */
  protected readonly sourceLabel = computed(
    () => this.event().sourceName?.trim() || "the organizer's site",
  );

  protected readonly buttonLabel = computed(() => {
    const source = this.event().sourceName?.trim();
    return source ? 'Register on ' + source : 'Go to the event page';
  });
}
