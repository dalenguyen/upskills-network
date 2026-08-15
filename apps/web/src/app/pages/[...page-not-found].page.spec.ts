import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, type AuthUser } from '../auth/auth-service';
import PageNotFoundComponent from './[...page-not-found].page';

describe('PageNotFoundComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [PageNotFoundComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(null),
            logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PageNotFoundComponent);
    fixture.detectChanges();

    return fixture;
  }

  it('renders a 404 page rather than an empty document', async () => {
    const fixture = await setup();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain(
      "We couldn't find that page",
    );
  });

  it('offers a way back to the site', async () => {
    const fixture = await setup();
    const element = fixture.nativeElement as HTMLElement;

    const home = Array.from(element.querySelectorAll('a')).find(
      (anchor) => anchor.getAttribute('href') === '/',
    );

    expect(home).toBeTruthy();
  });

  it('titles the tab', async () => {
    await setup();

    expect(TestBed.inject(Title).getTitle()).toBe('Page not found · Upskills');
  });
});
