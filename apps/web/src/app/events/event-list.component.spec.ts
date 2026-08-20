import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dashboardEventDeleteEndpoint,
  type DashboardEvent,
} from '../dashboard/dashboard-api';
import { workshop } from '../dashboard/testing/dashboard-fixtures';
import { EventListComponent } from './event-list.component';

describe('EventListComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(
    events: DashboardEvent[],
    options: {
      editLinkBase?: string | null;
      guestsLinkBase?: string | null;
      allowDelete?: boolean;
    } = {},
  ) {
    await TestBed.configureTestingModule({
      imports: [EventListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EventListComponent);

    fixture.componentRef.setInput('events', events);
    fixture.componentRef.setInput('orgId', 'org_1');
    fixture.componentRef.setInput('orgSlug', 'upskills-toronto');
    fixture.componentRef.setInput('editLinkBase', options.editLinkBase ?? null);
    fixture.componentRef.setInput(
      'guestsLinkBase',
      options.guestsLinkBase ?? null,
    );
    fixture.componentRef.setInput('allowDelete', options.allowDelete ?? false);
    fixture.detectChanges();

    return { fixture, http };
  }

  function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent?.trim() === text);

    if (button === undefined) {
      throw new Error(`No button with text ${text}`);
    }

    return button;
  }

  it('links a row to its edit page when an edit base is given', async () => {
    const { fixture, http } = await setup([workshop()], {
      editLinkBase: '/dashboard/events',
    });

    const root = fixture.nativeElement as HTMLElement;
    const hrefs = Array.from(root.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );

    expect(hrefs).toContain('/dashboard/events/evt_1/edit');
    expect(hrefs).toContain('/upskills-toronto/intro-to-kubernetes');
    http.verify();
  });

  it('links to the guest list with an org id when only a guests base is given', async () => {
    const { fixture, http } = await setup([workshop()], {
      guestsLinkBase: '/dashboard/events',
    });

    const root = fixture.nativeElement as HTMLElement;
    const guestsLink = Array.from(root.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Guests',
    );

    expect(guestsLink?.getAttribute('href')).toBe(
      '/dashboard/events/evt_1/guests?orgId=org_1',
    );
    expect(
      root.querySelector('a[href="/dashboard/events/evt_1/edit"]'),
    ).toBeNull();
    http.verify();
  });

  it('emits the row to edit when there is no edit base, instead of linking', async () => {
    const { fixture, http } = await setup([workshop()]);

    const edited: DashboardEvent[] = [];
    fixture.componentInstance.edit.subscribe((value) => edited.push(value));

    buttonByText(fixture.nativeElement as HTMLElement, 'Edit').click();

    expect(edited).toHaveLength(1);
    expect(edited[0].eventId).toBe('evt_1');
    http.verify();
  });

  it('offers Delete only on a draft, and only when the host allows it', async () => {
    const { fixture, http } = await setup([workshop({ status: 'published' })], {
      allowDelete: true,
    });

    const root = fixture.nativeElement as HTMLElement;
    const labels = Array.from(root.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );

    expect(labels).not.toContain('Delete');
    http.verify();
  });

  it('permanently deletes a confirmed draft and asks the host to reload', async () => {
    const { fixture, http } = await setup([workshop()], { allowDelete: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => (changed += 1));

    buttonByText(fixture.nativeElement as HTMLElement, 'Delete').click();
    fixture.detectChanges();

    const request = http.expectOne(
      dashboardEventDeleteEndpoint('org_1', 'evt_1'),
    );
    expect(request.request.method).toBe('DELETE');
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      eventId: 'evt_1',
      slug: 'intro-to-kubernetes',
      deleted: true,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(changed).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Event deleted',
    );
    http.verify();
  });

  it('issues no request when the delete is declined', async () => {
    const { fixture, http } = await setup([workshop()], { allowDelete: true });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    buttonByText(fixture.nativeElement as HTMLElement, 'Delete').click();
    await fixture.whenStable();

    http.verify();
  });

  it('explains a refused delete rather than reporting a generic failure', async () => {
    const { fixture, http } = await setup([workshop()], { allowDelete: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    buttonByText(fixture.nativeElement as HTMLElement, 'Delete').click();
    fixture.detectChanges();

    http
      .expectOne(dashboardEventDeleteEndpoint('org_1', 'evt_1'))
      .flush(
        { error: 'event-not-deletable' },
        { status: 409, statusText: 'Conflict' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Only a draft with no registrations can be deleted',
    );
    http.verify();
  });
});
