/**
 * One-off: send the waitlist welcome email.
 * Usage: npx tsx src/scripts/sendWaitlistTestEmail.ts [email]
 */
import { emailService } from '../services/EmailService.js';
import {
  WAITLIST_WELCOME_SUBJECT,
  waitlistWelcomeHtml,
} from '../emailTemplates/waitlistWelcome.js';

const to = process.argv[2] || 'treeki@outlook.com';

console.log(`Sending waitlist welcome to ${to}...`);

emailService
  .send(to, WAITLIST_WELCOME_SUBJECT, waitlistWelcomeHtml())
  .then(() => {
    console.log('Sent OK');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Send failed:', err);
    process.exit(1);
  });
