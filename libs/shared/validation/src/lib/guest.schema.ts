import { z } from 'zod';
import { CancelTokenSchema, EmailSchema } from './primitives';

/**
 * Public registration body. The event is identified by the route, not the body.
 * `email` arrives normalized, and the guest doc id is that exact string.
 */
export const RegisterGuestSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(120),
});

/**
 * Self-service cancellation. The token is the only authorization — an
 * unauthenticated caller who knows just the email must not be able to cancel.
 */
export const CancelGuestSchema = z.object({
  email: EmailSchema,
  cancelToken: CancelTokenSchema,
});

/** "Find my registrations" — collection-group lookup by normalized email. */
export const LookupSchema = z.object({
  email: EmailSchema,
});

/**
 * Staff check-in for one guest of the event named in the route. The email is
 * normalized, so it doubles as the guest doc id to `get()`.
 */
export const CheckInSchema = z.object({
  email: EmailSchema,
});

export type RegisterGuestInput = z.infer<typeof RegisterGuestSchema>;
export type CancelGuestInput = z.infer<typeof CancelGuestSchema>;
export type LookupInput = z.infer<typeof LookupSchema>;
export type CheckInInput = z.infer<typeof CheckInSchema>;
