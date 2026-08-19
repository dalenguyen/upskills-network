import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EventImageComponent } from './event-image.component';

/**
 * The image is the one part of an event page that is allowed to fail silently.
 *
 * Seeded events point at other people's CDNs, which go private, move, or start
 * refusing cross-origin loads. What matters is that a failure removes the
 * element rather than leaving a broken glyph — and that the failure belongs to
 * the URL that caused it, not to the component instance that happened to
 * render it.
 */
@Component({
  imports: [EventImageComponent],
  template: `<app-event-image [src]="src()" />`,
})
class Host {
  readonly src = signal<string | undefined>('https://example.com/a.jpg');
}

describe('EventImageComponent', () => {
  let fixture: ComponentFixture<Host>;

  function image(): HTMLImageElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('img');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('renders nothing when there is no src', () => {
    fixture.componentInstance.src.set(undefined);
    fixture.detectChanges();

    expect(image()).toBeNull();
  });

  it('marks the image decorative, lazy, and referrer-free', () => {
    const img = image();

    // Empty alt: every caller renders the event title as a heading beside it,
    // so a copy of the title here would be announced twice.
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('removes the element when the image fails to load', () => {
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(image()).toBeNull();
  });

  it('renders again for a different src after an earlier one failed', () => {
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(image()).toBeNull();

    // Angular reuses this instance when the browse list re-renders with a new
    // page of events. A "has failed" flag would hide every later event's image
    // without the browser ever requesting it.
    fixture.componentInstance.src.set('https://example.com/b.jpg');
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('https://example.com/b.jpg');
  });
});
