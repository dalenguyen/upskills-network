import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicEvent } from './event-api';
import {
  RegistrationFormComponent,
  registerEndpoint,
} from './registration-form.component';

const freeEvent: PublicEvent = {
  eventId: 'evt_1',
  orgId: 'org_1',
  orgSlug: 'acme',
  title: 'Intro to Kubernetes',
  slug: 'intro-to-kubernetes',
  description: 'A hands-on afternoon.',
  startsAt: '2026-09-10T13:30:00.000Z',
  timezone: 'America/Toronto',
  price: 0,
  currency: 'cad',
  maxGuests: 20,
  spotsRemaining: 5,
  soldOut: false,
};

describe('RegistrationFormComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegistrationFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  function create(event: PublicEvent = freeEvent) {
    const fixture = TestBed.createComponent(RegistrationFormComponent);
    fixture.componentRef.setInput('event', event);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  function fill(component: RegistrationFormComponent) {
    component.form.controls.name.setValue('Ada Lovelace');
    component.form.controls.email.setValue(' Ada@Example.COM ');
  }

  it('posts a normalized email and reports a confirmed registration', async () => {
    const { fixture, component } = create();
    fill(component);

    const pending = component.submit();
    fixture.detectChanges();

    const request = http.expectOne(registerEndpoint('org_1', 'evt_1'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
    request.flush({
      status: 'confirmed',
      alreadyRegistered: false,
      emailSent: true,
    });

    await pending;
    fixture.detectChanges();

    expect(component.status()).toBe('confirmed');
    expect(fixture.nativeElement.textContent).toContain("You're registered");
    http.verify();
  });

  it('reports a duplicate registration as already registered, not an error', async () => {
    const { fixture, component } = create();
    fill(component);

    const pending = component.submit();
    fixture.detectChanges();
    http.expectOne(registerEndpoint('org_1', 'evt_1')).flush({
      status: 'confirmed',
      alreadyRegistered: true,
      emailSent: true,
    });

    await pending;
    fixture.detectChanges();

    expect(component.status()).toBe('already-registered');
    expect(fixture.nativeElement.textContent).toContain(
      "You're already registered",
    );
    expect(fixture.nativeElement.textContent).not.toContain('went wrong');
  });

  it('distinguishes a waitlist place from a confirmed spot, and names the position', async () => {
    const { fixture, component } = create({ ...freeEvent, soldOut: true });
    fill(component);

    const pending = component.submit();
    fixture.detectChanges();
    http.expectOne(registerEndpoint('org_1', 'evt_1')).flush({
      status: 'waitlisted',
      alreadyRegistered: false,
      waitlistPosition: 3,
      emailSent: true,
    });

    await pending;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(component.status()).toBe('waitlisted');
    expect(text).toContain("You're on the waitlist");
    expect(text).toContain('3');
    expect(text).not.toContain("You're registered");
  });

  it('offers the waitlist explicitly when the event is sold out', () => {
    const { fixture } = create({
      ...freeEvent,
      soldOut: true,
      spotsRemaining: 0,
    });

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('full');
    expect(text).toContain('waitlist');
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
  });

  it('warns when the registration stuck but the confirmation email did not send', async () => {
    const { fixture, component } = create();
    fill(component);

    const pending = component.submit();
    fixture.detectChanges();
    http.expectOne(registerEndpoint('org_1', 'evt_1')).flush({
      status: 'confirmed',
      alreadyRegistered: false,
      emailSent: false,
    });

    await pending;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "couldn't send your confirmation email",
    );
  });

  it('rejects an invalid email without calling the API', async () => {
    const { fixture, component } = create();
    component.form.controls.name.setValue('Ada Lovelace');
    component.form.controls.email.setValue('not-an-email');

    await component.submit();
    fixture.detectChanges();

    expect(component.status()).toBe('inline-error');
    expect(fixture.nativeElement.textContent).toContain('valid email address');
    http.verify();
  });

  it('requires a name', async () => {
    const { fixture, component } = create();
    component.form.controls.name.setValue('   ');
    component.form.controls.email.setValue('ada@example.com');

    await component.submit();
    fixture.detectChanges();

    expect(component.status()).toBe('inline-error');
    expect(fixture.nativeElement.textContent).toContain('name');
    http.verify();
  });

  it('explains a cancelled event rather than showing a generic failure', async () => {
    const { fixture, component } = create();
    fill(component);

    const pending = component.submit();
    fixture.detectChanges();
    http
      .expectOne(registerEndpoint('org_1', 'evt_1'))
      .flush(
        { data: { error: 'event-cancelled' } },
        { status: 409, statusText: 'Conflict' },
      );

    await pending;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('cancelled');
  });

  it('explains a cancelled event when the failure arrives as an ofetch FetchError', async () => {
    // The production SSR shape — see event-api.ts. The browser normally posts
    // this form, but the classification must not depend on the error class.
    const fetchError = Object.assign(new Error('[POST] ".../register": 409'), {
      statusCode: 409,
      data: {
        error: true,
        statusCode: 409,
        data: { error: 'event-cancelled' },
      },
    });

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [RegistrationFormComponent],
      providers: [
        {
          provide: HttpClient,
          useValue: { post: () => throwError(() => fetchError) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(RegistrationFormComponent);
    fixture.componentRef.setInput('event', freeEvent);
    fixture.detectChanges();

    fill(fixture.componentInstance);
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('cancelled');
  });

  it('labels both fields and marks an invalid email for assistive tech', async () => {
    const { fixture, component } = create();
    const root: HTMLElement = fixture.nativeElement;

    for (const id of ['registration-name', 'registration-email']) {
      const input = root.querySelector<HTMLInputElement>(`#${id}`);
      expect(input, `#${id} exists`).toBeTruthy();
      expect(
        root.querySelector(`label[for="${id}"]`),
        `#${id} is labelled`,
      ).toBeTruthy();
    }

    component.form.controls.name.setValue('Ada Lovelace');
    component.form.controls.email.setValue('nope');
    await component.submit();
    fixture.detectChanges();

    expect(
      root.querySelector('#registration-email')?.getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('does not offer registration for a paid event while payment is unavailable', () => {
    const { fixture } = create({ ...freeEvent, price: 4500 });

    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).toContain('not open yet');
  });
});
