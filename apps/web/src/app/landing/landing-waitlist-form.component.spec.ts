import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  LandingWaitlistFormComponent,
  WAITLIST_ENDPOINT,
} from './landing-waitlist-form.component';

describe('LandingWaitlistFormComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingWaitlistFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  function create() {
    const fixture = TestBed.createComponent(LandingWaitlistFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('posts a normalized email and reports success', async () => {
    const { fixture, component } = create();
    component.form.controls.email.setValue(' Ada@Example.COM ');

    const pending = component.submit();
    fixture.detectChanges();

    const request = http.expectOne(WAITLIST_ENDPOINT);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'ada@example.com' });
    request.flush(
      { status: 'subscribed' },
      { status: 201, statusText: 'Created' },
    );

    await pending;
    fixture.detectChanges();

    expect(component.status()).toBe('success');
    expect(fixture.nativeElement.textContent).toContain("You're on the list");
    http.verify();
  });

  it('reports a duplicate as already on the list', async () => {
    const { fixture, component } = create();
    component.form.controls.email.setValue('ada@example.com');

    const pending = component.submit();
    const request = http.expectOne(WAITLIST_ENDPOINT);
    request.flush({ status: 'already_subscribed' });

    await pending;
    fixture.detectChanges();

    expect(component.status()).toBe('already-subscribed');
    expect(fixture.nativeElement.textContent).toContain(
      "You're already on the list.",
    );
    http.verify();
  });

  it('shows an inline error for an invalid email without calling the API', async () => {
    const { fixture, component } = create();
    component.form.controls.email.setValue('not-an-email');

    await component.submit();
    fixture.detectChanges();

    expect(component.status()).toBe('inline-error');
    expect(fixture.nativeElement.textContent).toContain(
      'Enter a valid email address.',
    );
    http.verify();
  });

  it('disables the submit button while the request is in flight', async () => {
    const { fixture, component } = create();
    component.form.controls.email.setValue('ada@example.com');

    const pending = component.submit();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Joining…');

    const request = http.expectOne(WAITLIST_ENDPOINT);
    request.flush({ status: 'subscribed' });

    await pending;
    http.verify();
  });

  // A bare `@else` on the status block also matched 'loading', so the idle
  // helper text rendered underneath a button already reading "Joining…".
  it('hides the idle helper text while the request is in flight', async () => {
    const { fixture, component } = create();
    const idleText = 'No spam';

    expect(fixture.nativeElement.textContent).toContain(idleText);

    component.form.controls.email.setValue('ada@example.com');
    const pending = component.submit();
    fixture.detectChanges();

    expect(component.status()).toBe('loading');
    expect(fixture.nativeElement.textContent).not.toContain(idleText);

    http.expectOne(WAITLIST_ENDPOINT).flush({ status: 'subscribed' });
    await pending;
    http.verify();
  });

  it('shows an inline error when the API rejects the email', async () => {
    const { fixture, component } = create();
    component.form.controls.email.setValue('ada@example.com');

    const pending = component.submit();
    http.expectOne(WAITLIST_ENDPOINT).flush(
      {
        error: true,
        statusCode: 400,
        message: 'Bad Request',
        data: { error: 'invalid-email' },
      },
      { status: 400, statusText: 'Bad Request' },
    );

    await pending;
    fixture.detectChanges();

    expect(component.status()).toBe('inline-error');
    expect(fixture.nativeElement.textContent).toContain(
      'Enter a valid email address.',
    );
    http.verify();
  });
});
