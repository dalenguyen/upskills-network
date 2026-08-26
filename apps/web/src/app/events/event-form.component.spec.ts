import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  dashboardEventUpdateEndpoint,
  type DashboardEvent,
} from '../dashboard/dashboard-api';
import { workshop } from '../dashboard/testing/dashboard-fixtures';
import { EventFormComponent } from './event-form.component';

describe('EventFormComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(event: DashboardEvent | null = null) {
    await TestBed.configureTestingModule({
      imports: [EventFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EventFormComponent);

    fixture.componentRef.setInput('orgId', 'org_1');
    fixture.componentRef.setInput('event', event);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, http };
  }

  function setValue(
    fixture: { nativeElement: unknown; detectChanges(): void },
    selector: string,
    value: string,
  ): void {
    const root = fixture.nativeElement as HTMLElement;
    const element = root.querySelector<HTMLInputElement>(selector);

    if (element === null) {
      throw new Error(`No form control matches ${selector}`);
    }

    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function slugValue(fixture: { nativeElement: unknown }): string | undefined {
    const root = fixture.nativeElement as HTMLElement;
    return root.querySelector<HTMLInputElement>('#slug')?.value;
  }

  it('re-derives the slug when an event whose slug matches its title is retitled', async () => {
    const { fixture, http } = await setup(
      workshop({ title: 'Intro to Kubernetes', slug: 'intro-to-kubernetes' }),
    );

    expect(slugValue(fixture)).toBe('intro-to-kubernetes');

    setValue(fixture, '#title', 'Intro to Docker');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(slugValue(fixture)).toBe('intro-to-docker');
    http.verify();
  });

  it('leaves a hand-picked slug alone when the event is retitled', async () => {
    // The stored slug is not what the title derives, so somebody chose it. A
    // rename must not move a URL they picked.
    const { fixture, http } = await setup(
      workshop({ title: 'Intro to Kubernetes', slug: 'k8s-101' }),
    );

    setValue(fixture, '#title', 'Intro to Docker');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(slugValue(fixture)).toBe('k8s-101');
    http.verify();
  });

  it('puts to the event own org, not the org input, so an admin edits in place', async () => {
    const { fixture, http } = await setup(
      workshop({ orgId: 'org_other', eventId: 'evt_9' }),
    );

    const root = fixture.nativeElement as HTMLElement;
    const publish = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Publish',
    );
    publish?.click();
    fixture.detectChanges();

    const request = http.expectOne(
      dashboardEventUpdateEndpoint('org_other', 'evt_9'),
    );
    expect(request.request.method).toBe('PUT');
    request.flush({ event: workshop({ status: 'published' }) });

    await fixture.whenStable();
    http.verify();
  });

  it('names the missing start date instead of issuing a doomed request', async () => {
    const { fixture, http } = await setup();

    const publish = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Publish');
    publish?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Choose when the event starts.',
    );
    http.verify();
  });

  it('rejects an end time before the start time instead of issuing a doomed request', async () => {
    const { fixture, http } = await setup();

    setValue(fixture, '#startsAt', '2026-09-01T18:00');
    setValue(fixture, '#endsAt', '2026-09-01T17:00');

    const publish = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Publish');
    publish?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'End time must be at or after the start time.',
    );
    http.verify();
  });

  it('warns when a price is set, since payments are not live yet', async () => {
    const { fixture, http } = await setup();

    expect(fixture.nativeElement.textContent).not.toContain(
      "Payments aren't live yet",
    );

    setValue(fixture, '#price', '49.50');

    expect(fixture.nativeElement.textContent).toContain(
      "Payments aren't live yet",
    );
    http.verify();
  });

  it('does not warn for a free event, including the default of 0', async () => {
    const { fixture, http } = await setup();

    setValue(fixture, '#price', '0');

    expect(fixture.nativeElement.textContent).not.toContain(
      "Payments aren't live yet",
    );
    http.verify();
  });

  it('offers a Cancel button only when the host asks for one', async () => {
    const { fixture, http } = await setup();

    const labels = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).map((button) => button.textContent?.trim());

    expect(labels()).not.toContain('Cancel');

    fixture.componentRef.setInput('showCancel', true);
    fixture.detectChanges();

    expect(labels()).toContain('Cancel');
    http.verify();
  });
});
