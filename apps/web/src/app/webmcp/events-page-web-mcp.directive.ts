import { Directive, inject } from '@angular/core';

import { eventPath, type PublicEvent } from '../events/event-api';
import EventsPageComponent from '../pages/events/index.page';
import { registerWebMcpTools } from './web-mcp';

type EventList = 'upcoming' | 'past';

/**
 * WebMCP tools for the `/events` page (dev builds only).
 *
 * - `events_list_state` reports both lists as JSON.
 * - `events_load_more` pages one list, or all of it.
 *
 * An agent calls these instead of scrolling, clicking "Load more" and reading
 * the page again. The directive sits on an element inside the page's template
 * and injects the page, so it uses only the page's public API and the page
 * holds no tool code. See `web-mcp.ts` for why tools are dev-only.
 */
@Directive({ selector: '[appEventsPageWebMcp]' })
export class EventsPageWebMcpDirective {
  private readonly page = inject(EventsPageComponent);

  constructor() {
    registerWebMcpTools([
      {
        name: 'events_list_state',
        description:
          'Report the /events page: load status, and the upcoming and past lists with each event title, path and start time, plus whether each list has more pages.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.listState(),
      },
      {
        name: 'events_load_more',
        description:
          'Load the next page of the upcoming or past list, like the "Load more" button. With all: true, keep loading until the list ends. Returns the list state after loading.',
        inputSchema: {
          type: 'object',
          properties: {
            list: { type: 'string', enum: ['upcoming', 'past'] },
            all: { type: 'boolean' },
          },
          required: ['list'],
        },
        execute: (input: { list: EventList; all?: boolean }) =>
          this.loadMore(input.list, input.all === true),
      },
    ]);
  }

  listState() {
    const past = this.page.past();

    return {
      status: this.page.state().status,
      upcoming: {
        count: this.page.events().length,
        hasMore: this.page.nextCursor() !== null,
        events: this.page.events().map(summary),
      },
      past: {
        count: past?.events.length ?? 0,
        hasMore: (past?.nextCursor ?? null) !== null,
        events: past?.events.map(summary) ?? [],
      },
    };
  }

  async loadMore(
    list: EventList,
    all: boolean,
  ): Promise<ReturnType<EventsPageWebMcpDirective['listState']>> {
    if (list !== 'upcoming' && list !== 'past') {
      throw new Error(`list must be "upcoming" or "past", got ${String(list)}`);
    }

    while (this.hasMore(list)) {
      const before = this.count(list);
      await (list === 'upcoming'
        ? this.page.loadMore()
        : this.page.loadMorePast());

      // A failed page keeps its cursor. Stop instead of looping on it.
      if (this.count(list) === before) {
        throw new Error(`Loading more ${list} events failed. Try again.`);
      }

      if (!all) {
        break;
      }
    }

    return this.listState();
  }

  private hasMore(list: EventList): boolean {
    return list === 'upcoming'
      ? this.page.nextCursor() !== null
      : (this.page.past()?.nextCursor ?? null) !== null;
  }

  private count(list: EventList): number {
    return list === 'upcoming'
      ? this.page.events().length
      : (this.page.past()?.events.length ?? 0);
  }
}

function summary(event: PublicEvent) {
  return {
    title: event.title,
    path: eventPath(event),
    startsAt: event.startsAt,
  };
}
