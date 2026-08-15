import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createLimiter } from '../middleware/rateLimiter.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { Waitlist } from '../models/Waitlist.js';
import { discordService } from '../services/DiscordService.js';

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

function clientIp(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  if (Array.isArray(forwarded) && forwarded[0]) return String(forwarded[0]).trim();
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * POST /waitlist
 * Public beta / waitlist signup for the marketing site → `waitlists` collection.
 */
router.post(
  '/',
  waitlistLimiter,
  validate(joinSchema),
  catchAsync(async (req, res) => {
    const email = String(req.body.email).trim().toLowerCase();
    const source = typeof req.body.source === 'string' ? req.body.source : 'marketing';
    const ip = clientIp(req);

    const existing = await Waitlist.findOne({ email }).lean();
    if (existing) {
      void discordService.trackWaitlist({
        email,
        ip,
        source,
        alreadyJoined: true,
      });
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
      ipAddress: ip,
      betaCohort: '2026-09-21',
    });

    void discordService.trackWaitlist({ email, ip, source, alreadyJoined: false });

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
