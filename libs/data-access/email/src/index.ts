export {
  DEFAULT_FROM,
  DEFAULT_SITE_URL,
  EMAIL_FROM_ENV,
  EMAIL_REPLY_TO_ENV,
  RESEND_API_KEY_ENV,
  SITE_URL_ENV,
  fromAddress,
  replyToAddress,
  resendApiKey,
  siteUrl,
} from './lib/config';

export { getEmailClient, setEmailClient } from './lib/client';
export type { EmailClient } from './lib/client';

export { sendEmail } from './lib/send';
export type { EmailMessage, SendFailureReason, SendResult } from './lib/send';

export {
  CANCEL_PATH,
  cancelUrl,
  eventUrl,
  formatEventDay,
  formatEventWhen,
  formatMoney,
  formatPrice,
  greetingName,
  guestListUrl,
} from './lib/format';

export {
  composeMessage,
  escapeHtml,
  renderHtml,
  renderText,
} from './lib/layout';
export type { EmailFact, EmailLayout, EmailNote } from './lib/layout';

export {
  renderCancellationEmail,
  renderPaymentReceiptEmail,
  renderSoldOutRefundEmail,
  renderSpotOpenedEmail,
  renderWaitlistEmail,
  renderWelcomeEmail,
  sendCancellationEmail,
  sendPaymentReceiptEmail,
  sendSoldOutRefundEmail,
  sendSpotOpenedEmail,
  sendWaitlistEmail,
  sendWelcomeEmail,
} from './lib/templates/guest';

export {
  renderWaitlistConfirmationEmail,
  sendWaitlistConfirmationEmail,
} from './lib/templates/waitlist';

export {
  renderEventReminder,
  sendEventReminder,
} from './lib/templates/reminder';

export {
  renderOrganizerNotification,
  sendOrganizerNotification,
} from './lib/templates/organizer';
export type {
  AddressedSendResult,
  FanOutResult,
  OrganizerNotificationDetails,
  OrganizerNotificationType,
  OrganizerRecipient,
} from './lib/templates/organizer';
