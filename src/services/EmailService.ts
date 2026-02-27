import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('EmailService');

/**
 * Transactional email service using SMTP.
 * Exported as a singleton (`emailService`).
 */
class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp0001.neo.space',
      port: 465,
      secure: true,
      auth: {
        user: 'hello@hatchly.app',
        pass: env.EMAIL_PASSWORD,
      },
    });
    log.info('EmailService initialised');
  }

  /**
   * Sends a plain-text or HTML email.
   *
   * @param to      — Recipient email address
   * @param subject — Email subject line
   * @param html    — HTML body content
   */
  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: '"Hatchly" <hello@hatchly.app>',
        to,
        subject,
        html,
      });
      log.info({ to, subject }, 'Email sent');
    } catch (err: any) {
      log.error({ err, to, subject }, 'Failed to send email');
      throw new AppError('Email delivery failed', 502, 'EMAIL_SEND_FAILED');
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const emailService = new EmailService();
