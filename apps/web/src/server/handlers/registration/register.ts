import type { SendResult } from '@upskills/email';
import type { ReserveSpotResult } from '@upskills/firestore';
import type { Guest, Organizer, WorkshopEvent } from '@upskills/models';
import { RegisterGuestSchema } from '@upskills/validation';
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, notFound, toHttpError } from '../http-error';
import type { NotifyOrganizers } from '../organizer-notify';
import { conflict } from './registration-errors';

/**
 * `POST /api/v1/registration/:orgId/:eventId/register` — the free registration
 * path.
 *
 * ## Why the organizer is in the path
 *
 * Events live at `organizers/{orgId}/events/{eventId}`, so an event id on its
 * own no longer addresses a document. The organizer segment is not a permission
 * check and is not trusted as one: naming the wrong organizer simply addresses
 * a path where no event exists, and answers the same 404 as a made-up event id.
 *
 * ## What this route does not decide
 *
 * Capacity, publication status, and price are all decided inside
 * `reserveSpot`'s transaction, not here. This handler reads the event once
 * beforehand, but only to answer a cheap 404 and to have the content of the
 * email it sends afterwards; nothing it reads is allowed to gate the write.
 *
 * An earlier revision *did* gate on that read — it refused a paid event before
 * calling `reserveSpot` — and it was wrong twice over. It was a check-then-act
 * race, because a free event could acquire a price between the read and the
 * commit. And because the price gate ran before the status check inside the
 * transaction, a **draft paid** event answered 409 while every other draft
 * answered 404, which is precisely the distinguishable response the next
 * section exists to prevent. Both disappear once the decision lives in one
 * place, against one read, in one order.
 *
 * ## Draft answers 404, cancelled answers 409
 *
 * Two different situations wearing one error class. A **draft** event was never
 * public, and its slug is guessable, so it must answer exactly what a
 * nonexistent event answers — the same argument as `event-detail.ts`. A
 * **cancelled** event *was* public: the caller plausibly has a stale tab open
 * from before it was called off. They already know it exists, so hiding it buys
 * nothing and a 409 that says "this event was cancelled" is the difference
 * between a guest who understands and a guest who emails the organizer.
 *
 * ## Registering twice is a success, not an error
 *
 * A double-submitted form, a reloaded confirmation page, and a guest who
 * genuinely forgot they signed up all land here. `reserveSpot` answers
 * `alreadyRegistered` for all three, and this route reports 200 with the
 * standing registration and **sends no second email**. Answering 409 would
 * turn a duplicate click into a visible failure for someone who is, in fact,
 * registered.
 *
 * ## A failed email does not fail the registration
 *
 * The seat is committed before any mail is attempted, and `sendEmail` never
 * throws. So a Resend outage produces a registered guest with no confirmation
 * mail — which is a real problem, because the cancel token only ever travels by
 * email and a guest without it cannot release their own spot. It is reported in
 * `emailSent` so the page can tell them to contact the organizer, rather than
 * silently claiming everything is fine.
 */

export interface RegisterResponse {
  /** What the guest ended up with. */
  status: 'confirmed' | 'waitlisted';
  /** `true` when this call found a registration that already existed. */
  alreadyRegistered: boolean;
  /** Present only when waitlisted: the position as of registration. */
  waitlistPosition?: number;
  /**
   * Whether the confirmation (or waitlist) email was accepted for delivery.
   * `false` means the guest has no cancel link — see the module comment.
   */
  emailSent: boolean;
}

export interface RegisterDeps {
  /** `getEvent` from `@upskills/firestore`. */
  getEvent(orgId: string, eventId: string): Promise<WorkshopEvent | null>;
  /** `getOrg` from `@upskills/firestore`. Resolves the org slug the confirmation email links to. */
  getOrg(orgId: string): Promise<Organizer | null>;
  /** `reserveSpot` from `@upskills/firestore`, in `confirm` mode. */
  reserveSpot(
    orgId: string,
    eventId: string,
    draft: { email: string; name: string },
  ): Promise<ReserveSpotResult>;
  /** `sendWelcomeEmail` from `@upskills/email`. Never throws. */
  sendWelcomeEmail(
    guest: Guest,
    event: WorkshopEvent,
    orgSlug: string,
  ): Promise<SendResult>;
  /** `sendWaitlistEmail` from `@upskills/email`. Never throws. */
  sendWaitlistEmail(
    guest: Guest,
    event: WorkshopEvent,
    position: number,
    orgSlug: string,
  ): Promise<SendResult>;
  /**
   * Tell the org's staff someone signed up. See `handlers/organizer-notify.ts`
   * — it swallows its own failures, and nothing in the response depends on it.
   */
  notifyOrganizers: NotifyOrganizers;
}

/** The one 404 this route produces — for a missing *or* draft event. */
function eventNotFound() {
  return notFound('event-not-found', 'No such event.');
}

/**
 * Map a `reserveSpot` failure to a response.
 *
 * Matched by `name` rather than `instanceof` for the same reason `http-error.ts`
 * does it: importing the classes as values would drag `@upskills/firestore`
 * into this module, and every spec for it, at runtime.
 */
function asRegistrationError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (error.name === 'EventNotFoundError') {
    return eventNotFound();
  }

  if (error.name === 'EventNotRegisterableError') {
    const status = (error as { status?: unknown }).status;

    return status === 'cancelled'
      ? conflict('event-cancelled', 'This event has been cancelled.')
      : eventNotFound();
  }

  if (error.name === 'EventIsExternalError') {
    // A listed-only event: Upskills shows it, someone else runs it. The
    // detail page hides the form for these, so reaching here means a stale
    // tab, a scripted post, or a listing that acquired its `externalUrl`
    // between the page loading and the form being submitted. Naming the
    // destination is what makes the refusal actionable — the caller already
    // saw the event, so there is nothing left to conceal.
    const externalUrl = (error as { externalUrl?: unknown }).externalUrl;

    return conflict(
      'event-external',
      typeof externalUrl === 'string'
        ? `Registration for this event is handled at ${externalUrl}.`
        : 'Registration for this event is handled on the organizer’s own site.',
    );
  }

  if (error.name === 'PaymentRequiredError') {
    // The paid path — hold the seat, then hand back a Stripe Checkout URL — is
    // issue #47 and is deliberately outside the MVP. Refusing loudly is the
    // only safe placeholder: falling through would confirm a paid seat for
    // nothing.
    return conflict(
      'payment-required',
      'This event requires payment, which is not available yet.',
    );
  }

  return error;
}

export function createRegisterHandler(deps: RegisterDeps): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    try {
      const orgId = getRouterParam(event, 'orgId');
      const eventId = getRouterParam(event, 'eventId');

      if (!orgId || !eventId) {
        throw eventNotFound();
      }

      const parsed = RegisterGuestSchema.safeParse(await readBody(event));

      if (!parsed.success) {
        throw badRequest(
          'invalid-registration',
          'Enter a valid email address and a name.',
        );
      }

      const workshop = await deps.getEvent(orgId, eventId);

      if (workshop === null) {
        throw eventNotFound();
      }

      const org = await deps.getOrg(orgId);

      if (org === null) {
        throw eventNotFound();
      }

      const result = await deps
        .reserveSpot(orgId, eventId, {
          email: parsed.data.email,
          name: parsed.data.name,
        })
        .catch((error: unknown) => {
          throw asRegistrationError(error);
        });

      return {
        ...outcomeOf(result),
        alreadyRegistered: result.alreadyRegistered,
        emailSent: await notify(result, workshop, org.slug, deps),
      } satisfies RegisterResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

/** The reservation outcome, as the response reports it. */
function outcomeOf(
  result: ReserveSpotResult,
): Pick<RegisterResponse, 'status' | 'waitlistPosition'> {
  if (result.outcome === 'waitlisted') {
    return {
      status: 'waitlisted',
      // `reserveSpot` always sets this on a pending guest; the fallback only
      // exists so a missing field cannot crash a committed registration.
      waitlistPosition: result.guest.waitlistPosition ?? 0,
    };
  }

  // `held` cannot occur: this route only ever reserves in `confirm` mode, and
  // refuses paid events outright.
  return { status: 'confirmed' };
}

/**
 * Send the one email this registration warrants, tell the organizer, and report
 * whether the guest's copy left.
 *
 * A repeat registration sends nothing — the guest already has the original,
 * carrying the same still-valid cancel token — and reports `true`, because from
 * the guest's side the mail they need is already in their inbox. The organizer
 * is not told either: they heard about this registration the first time, and a
 * second notice would read as a second signup.
 *
 * Only the guest's send decides the return value. The organizer notification is
 * awaited so it cannot outlive the request on a serverless instance, but its
 * outcome is deliberately not consulted — see `handlers/organizer-notify.ts`.
 */
async function notify(
  result: ReserveSpotResult,
  workshop: WorkshopEvent,
  orgSlug: string,
  deps: RegisterDeps,
): Promise<boolean> {
  if (result.alreadyRegistered) {
    return true;
  }

  const waitlisted = result.outcome === 'waitlisted';

  const sent = waitlisted
    ? await deps.sendWaitlistEmail(
        result.guest,
        workshop,
        result.guest.waitlistPosition ?? 0,
        orgSlug,
      )
    : await deps.sendWelcomeEmail(result.guest, workshop, orgSlug);

  // Guarded here as well as inside the notifier. A committed registration
  // answering 200 is this handler's own guarantee, and borrowing it from the
  // error handling of an injected dependency is exactly the kind of promise
  // that survives until someone wires the dep differently.
  await deps
    .notifyOrganizers(
      workshop.orgId,
      workshop,
      waitlisted ? 'waitlist_joined' : 'registration',
      { guest: result.guest },
    )
    .catch(() => undefined);

  return sent.sent;
}
