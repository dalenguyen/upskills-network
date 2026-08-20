import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EventImageComponent } from './event-image.component';

/**
 * The image is the one part of an event page that is allowed to fail silently —
 * but it is never allowed to leave a hole.
 *
 * Seeded events point at other people's CDNs, which go private, move, or start
 * refusing cross-origin loads, and most events carry no image at all. Both cases
 * must land on the same stand-in, so the browse list keeps its shape whether an
 * event has a picture, never had one, or had one that broke mid-scroll.
 */
@Component({
  imports: [EventImageComponent],
  template: `<app-event-image
    [src]="src()"
    [title]="title()"
    [seed]="seed()"
  />`,
})
class Host {
  readonly src = signal<string | undefined>('https://example.com/a.jpg');
  readonly title = signal('Toronto AI Meetup');
  readonly seed = signal('toronto-ai-meetup');
}

describe('EventImageComponent', () => {
  let fixture: ComponentFixture<Host>;

  function image(): HTMLImageElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('img');
  }

  function placeholder(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="event-image-placeholder"]',
    );
  }

  /**
   * The stand-in's gradient classes, sorted.
   *
   * Angular's `[class]` binding reorders the string it is given, so the raw
   * `className` is not comparable between renders even when the colour has not
   * changed.
   */
  function colour(): string[] {
    return (placeholder()?.className ?? '')
      .split(/\s+/)
      .filter((name) => name.startsWith('from-') || name.startsWith('to-'))
      .sort();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('marks the image decorative, lazy, and referrer-free', () => {
    const img = image();

    // Empty alt: every caller renders the event title as a heading beside it,
    // so a copy of the title here would be announced twice.
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(placeholder()).toBeNull();
  });

  it('stands in with the title initials when there is no src', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.detectChanges();

    expect(image()).toBeNull();
    expect(placeholder()?.textContent?.trim()).toBe('TA');
  });

  it('hides the stand-in from screen readers', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.detectChanges();

    // The initials are the title's, and the title is a heading beside this
    // block — announcing them would be reading it twice.
    expect(placeholder()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the stand-in when the image fails to load', () => {
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    // Not removal: the card already reserved this space, and collapsing it
    // mid-scroll moves everything below a broken image.
    expect(image()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('renders again for a different src after an earlier one failed', () => {
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(image()).toBeNull();

    // Angular reuses this instance when the browse list re-renders with a new
    // page of events. A "has failed" flag would send every later event to its
    // initials without the browser ever requesting its image.
    fixture.componentInstance.src.set('https://example.com/b.jpg');
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('https://example.com/b.jpg');
  });

  it('gives the same seed the same colour every time', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.detectChanges();
    const first = colour();

    fixture.componentInstance.seed.set('something-else');
    fixture.detectChanges();
    fixture.componentInstance.seed.set('toronto-ai-meetup');
    fixture.detectChanges();

    // Server and browser render this independently; a colour that is not a pure
    // function of the seed would flicker on hydration.
    expect(colour()).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it('keeps the caller sizing classes on the stand-in', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.detectChanges();

    // The stand-in occupies exactly the box the image would have.
    expect(placeholder()?.className).toContain('w-full');
  });

  it('skips punctuation when reducing a title to initials', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.componentInstance.title.set('— M365 Toronto 2026');
    fixture.detectChanges();

    // The dash is dropped entirely rather than becoming the first initial.
    expect(placeholder()?.textContent?.trim()).toBe('MT');
  });

  it('renders a bullet rather than an empty box for a title with no letters', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.componentInstance.title.set('   ');
    fixture.detectChanges();

    expect(placeholder()?.textContent?.trim()).toBe('•');
  });
});
