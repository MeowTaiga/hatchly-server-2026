import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createLimiter } from '../middleware/rateLimiter.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { discordService } from '../services/DiscordService.js';

const router = Router();

const pingLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
});

const pingSchema = {
  body: z.object({
    kind: z.enum(['visit', 'click']),
    url: z.string().max(500).optional(),
    userAgent: z.string().max(1024).optional(),
    label: z.string().max(120).optional(),
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
 * POST /analytics/ping
 * Public marketing analytics — visit / click cards to Discord.
 */
router.post(
  '/ping',
  pingLimiter,
  validate(pingSchema),
  catchAsync(async (req, res) => {
    const { kind, url, userAgent, label } = req.body as {
      kind: 'visit' | 'click';
      url?: string;
      userAgent?: string;
      label?: string;
    };

    const ip = clientIp(req);
    const page = (url || 'https://hatchly.me/').slice(0, 500);
    const ua = (userAgent || req.headers['user-agent'] || 'unknown').slice(0, 1024);

    if (kind === 'click') {
      void discordService.trackClick({
        url: page,
        userAgent: ua,
        ip,
        label: label || 'button',
      });
    } else {
      void discordService.trackVisit({ url: page, userAgent: ua, ip });
    }

    success(res, { ok: true });
  }),
);

export default router;
