import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createLimiter } from '../middleware/rateLimiter.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { Waitlist } from '../models/Waitlist.js';

const router = Router();

const waitlistLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
});

const joinSchema = {
  body: z.object({
    email: z.string().email('A valid email is required'),
    source: z.string().max(80).optional(),
  }),
};

/**
 * POST /waitlist
 * Public beta / waitlist signup for the marketing site.
 */
router.post(
  '/',
  waitlistLimiter,
  validate(joinSchema),
  catchAsync(async (req, res) => {
    const email = String(req.body.email).trim().toLowerCase();
    const source = typeof req.body.source === 'string' ? req.body.source : 'marketing';

    const existing = await Waitlist.findOne({ email }).lean();
    if (existing) {
      success(res, {
        message: 'Already on the waitlist',
        alreadyJoined: true,
      });
      return;
    }

    await Waitlist.create({
      email,
      source,
      userAgent: req.headers['user-agent'],
      referrer: req.headers.referer,
      ipAddress: req.ip,
      betaCohort: '2026-09-21',
    });

    success(
      res,
      {
        message: 'Successfully joined the beta waitlist',
        alreadyJoined: false,
      },
      201,
    );
  }),
);

export default router;
