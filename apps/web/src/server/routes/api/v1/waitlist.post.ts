import { sendWaitlistConfirmationEmail } from '@upskills/email';
import { addWaitlistSubscriber } from '@upskills/firestore';
import { createWaitlistPostHandler } from '../../../handlers/waitlist/waitlist-post';

/**
 * `POST /api/v1/waitlist`
 *
 * Wiring only — see `handlers/waitlist/waitlist-post.ts` for the behavior, and
 * `routes/api/v1/auth/session.post.ts` for why the split exists.
 */
export default createWaitlistPostHandler({
  addWaitlistSubscriber: (email) => addWaitlistSubscriber(email),
  sendWaitlistConfirmationEmail: (email) => sendWaitlistConfirmationEmail(email),
});
