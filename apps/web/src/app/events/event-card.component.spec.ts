import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicEvent } from './event-api';
import { EventCardComponent } from './event-card.component';

const baseEvent: PublicEvent = {
  eventId: 'evt_1',
  orgId: 'org_1',
  orgSlug: 'acme',
  title: 'Intro to Kubernetes',
  slug: 'intro-to-kubernetes',
  description: 'A hands-on afternoon.',
  startsAt: '2026-09-10T13:30:00.000Z',
  timezone: 'America/Toronto',
  location: 'MaRS Centre, Toronto',
  price: 0,
  currency: 'cad',
  maxGuests: 20,
  spotsRemaining: 12,
  soldOut: false,
};

describe('EventCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventCardComponent],
    }).compileComponents();
  });

  function render(event: Partial<PublicEvent> = {}) {
    const fixture = TestBed.createComponent(EventCardComponent);
    fixture.componentRef.setInput('event', { ...baseEvent, ...event });
    fixture.detectChanges();
    return fixture;
  }

  it('links to the event detail page and shows title, when, and where', () => {
    const fixture = render();
    const anchor = fixture.nativeElement.querySelector('a');

    expect(anchor.getAttribute('href')).toBe('/acme/intro-to-kubernetes');
    expect(fixture.nativeElement.textContent).toContain('Intro to Kubernetes');
    expect(fixture.nativeElement.textContent).toContain('September 10, 2026');
    expect(fixture.nativeElement.textContent).toContain('MaRS Centre, Toronto');
  });

  it('links the location to a Google Maps search in a new tab', () => {
    const fixture = render();
    const link = fixture.nativeElement.querySelector(
      'a[href^="https://www.google.com/maps/search/"]',
    );

    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=MaRS%20Centre%2C%20Toronto',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(link.textContent).toContain('MaRS Centre, Toronto');
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

  it('omits the location row when the event has no location', () => {
    const fixture = render({ location: undefined });

    expect(fixture.nativeElement.textContent).not.toContain('MaRS');
    expect(
      fixture.nativeElement.querySelector(
        'a[href^="https://www.google.com/maps/search/"]',
      ),
    ).toBeNull();
  });
});
