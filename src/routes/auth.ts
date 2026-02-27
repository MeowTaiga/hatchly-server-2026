import { Router } from 'express';
import { z } from 'zod';
import { twilioService } from '../services/TwilioService.js';
import { UserEntity } from '../entities/UserEntity.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ── Validation schemas ──────────────────────────────────────────────────────

const requestCodeSchema = {
  body: z.object({
    phone: z.string().min(10, 'Phone number must be at least 10 digits'),
  }),
};

const verifyCodeSchema = {
  body: z.object({
    phone: z.string().min(10, 'Phone number must be at least 10 digits'),
    code: z.string().length(6, 'Code must be exactly 6 digits'),
  }),
};

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /auth/request-code
 * Sends a Twilio SMS verification code to the given phone number.
 */
router.post(
  '/request-code',
  authLimiter,
  validate(requestCodeSchema),
  catchAsync(async (req, res) => {
    const { phone } = req.body;
    await twilioService.sendCode(phone);
    success(res, { message: 'Verification code sent' });
  }),
);

/**
 * POST /auth/verify-code
 * Verifies the SMS code, finds or creates the user, and returns a JWT.
 */
router.post(
  '/verify-code',
  authLimiter,
  validate(verifyCodeSchema),
  catchAsync(async (req, res) => {
    const { phone, code } = req.body;

    const approved = await twilioService.verifyCode(phone, code);
    if (!approved) {
      throw new AppError('Invalid verification code', 401, 'INVALID_CODE');
    }

    const { entity, isNewUser } = await UserEntity.findOrCreateByPhone(phone);
    const { token, user } = await entity.login();

    success(res, { token, user, isNewUser });
  }),
);

export default router;
