import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicEvent } from './event-api';
import { EventDetailComponent } from './event-detail.component';

const baseEvent: PublicEvent = {
  eventId: 'evt_1',
  orgId: 'org_1',
  orgSlug: 'acme',
  title: 'Intro to Kubernetes',
  slug: 'intro-to-kubernetes',
  description: 'First line.\nSecond line.',
  startsAt: '2026-09-10T13:30:00.000Z',
  timezone: 'America/Toronto',
  location: 'MaRS Centre, Toronto',
  price: 0,
  currency: 'cad',
  maxGuests: 20,
  spotsRemaining: 12,
  soldOut: false,
};

describe('EventDetailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventDetailComponent],
    }).compileComponents();
  });

  function render(event: Partial<PublicEvent> = {}) {
    const fixture = TestBed.createComponent(EventDetailComponent);
    fixture.componentRef.setInput('event', { ...baseEvent, ...event });
    fixture.detectChanges();
    return fixture;
  }

  it('leads with the title, the time in the event timezone, and the location', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent;

    expect(fixture.nativeElement.querySelector('h1').textContent).toContain(
      'Intro to Kubernetes',
    );
    expect(text).toContain('September 10, 2026');
    expect(text).toContain('9:30');
    expect(text).toContain('MaRS Centre, Toronto');
  });

  it('names a free event as free', () => {
    expect(render().nativeElement.textContent).toContain('Free');
  });

  it('shows the price for a paid event', () => {
    expect(render({ price: 4500 }).nativeElement.textContent).toContain(
      '$45.00 CAD',
    );
  });

  it('flags a sold-out event instead of a spot count', () => {
    const text = render({ soldOut: true, spotsRemaining: 0 }).nativeElement
      .textContent;

    expect(text).toContain('Sold out');
    expect(text).not.toContain('spots left');
  });

  it('counts down only once spots are scarce', () => {
    expect(render({ spotsRemaining: 3 }).nativeElement.textContent).toContain(
      '3/20 spots left',
    );
    expect(
      render({ spotsRemaining: 40 }).nativeElement.textContent,
    ).not.toContain('spots left');
  });

  it('omits the location row when the event has no location', () => {
    const fixture = render({ location: undefined });

    expect(fixture.nativeElement.textContent).not.toContain('MaRS');
  });

  it('renders the description as text, never as markup', () => {
    const fixture = render({ description: '<img src=x onerror=alert(1)>' });

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('<img src=x');
  });
});
