import Twilio from 'twilio';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { formatE164 } from '../utils/phone.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('TwilioService');

/**
 * Handles phone number verification via Twilio Verify v2.
 *
 * This is the only authentication mechanism in the app — no passwords,
 * no OAuth. The user proves they own a phone number, and that's their
 * identity.
 *
 * Exported as a singleton instance (`twilioService`).
 */
class TwilioService {
  private client: ReturnType<typeof Twilio>;
  private serviceSid: string;

  constructor() {
    this.client = Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    this.serviceSid = env.TWILIO_VERIFY_SERVICE_SID;
    log.info('Twilio client initialised');
  }

  /**
   * Sends a 6-digit SMS verification code to the given phone number.
   *
   * @param rawPhone — Any format; will be normalised to E.164 internally.
   * @throws {AppError} 500 if Twilio rejects the request.
   */
  async sendCode(rawPhone: string): Promise<void> {
    const phone = formatE164(rawPhone);
    log.debug({ phone }, 'Sending verification code');

    try {
      const verification = await this.client.verify.v2
        .services(this.serviceSid)
        .verifications.create({ to: phone, channel: 'sms' });

      log.info({ phone, status: verification.status }, 'Verification code sent');
    } catch (err: any) {
      log.error({ err, phone }, 'Failed to send verification code');
      throw new AppError(
        `Failed to send verification code: ${err.message ?? 'Unknown Twilio error'}`,
        500,
        'TWILIO_SEND_FAILED',
      );
    }
  }

  /**
   * Checks a verification code against what Twilio has on file.
   *
   * @param rawPhone — Any format; normalised internally.
   * @param code     — The 6-digit code the user entered.
   * @returns `true` if the code is correct, `false` if incorrect.
   * @throws {AppError} 500 on unexpected Twilio errors.
   */
  async verifyCode(rawPhone: string, code: string): Promise<boolean> {
    const phone = formatE164(rawPhone);
    log.debug({ phone }, 'Verifying code');

    try {
      const check = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phone, code });

      const approved = check.status === 'approved';
      log.info({ phone, approved }, 'Verification check complete');
      return approved;
    } catch (err: any) {
      log.error({ err, phone }, 'Failed to verify code');
      throw new AppError(
        `Failed to verify code: ${err.message ?? 'Unknown Twilio error'}`,
        500,
        'TWILIO_VERIFY_FAILED',
      );
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const twilioService = new TwilioService();
