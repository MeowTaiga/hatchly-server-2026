import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { MoodLog, MOOD_OPTIONS } from '../models/MoodLog.js';
import { grantActionRewards } from '../services/ActionRewardService.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const logSchema = {
  body: z.object({
    mood: z.enum(MOOD_OPTIONS as unknown as [string, ...string[]]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const getSchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

router.post(
  '/log',
  protect,
  validate(logSchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as any).timezone;
    const date = req.body.date ?? getTodayDateStr(timezone);

    const existing = await MoodLog.findOne({ userId, date });
    if (existing) throw new AppError('Mood already logged for today', 400, 'MOOD_ALREADY_LOGGED');

    const entry = await MoodLog.create({ userId, date, mood: req.body.mood });
    const { pet, xpGained, gemsAwarded } = await grantActionRewards(userId, 'mood', date);

    success(res, { log: entry, pet, xpGained, gemsAwarded }, 201);
  }),
);

router.get(
  '/log',
  protect,
  validate(getSchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as any).timezone;
    const date = (req.query as any).date ?? getTodayDateStr(timezone);

    const log = await MoodLog.findOne({ userId, date }).lean();
    success(res, { log: log ? { mood: log.mood, date: log.date } : null });
  }),
);

export default router;
