import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { MoodLog, MOOD_OPTIONS } from '../models/MoodLog.js';
import {
  getMoodRewardStatus,
  tryGrantMoodDiaryReward,
} from '../services/MoodDiaryRewardService.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';

const router = Router();

const logSchema = {
  body: z.object({
    mood: z.enum(MOOD_OPTIONS as unknown as [string, ...string[]]),
    note: z.string().max(500).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const getDaySchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const historySchema = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(365).optional(),
  }),
};

function serializeLog(entry: {
  _id?: unknown;
  id?: string;
  mood: string;
  date: string;
  note?: string;
  rewarded?: boolean;
  createdAt?: Date;
}) {
  return {
    id: entry.id ?? (entry._id as { toString(): string })?.toString?.(),
    mood: entry.mood,
    date: entry.date,
    note: entry.note ?? undefined,
    rewarded: entry.rewarded ?? false,
    createdAt: entry.createdAt?.toISOString?.() ?? undefined,
  };
}

/**
 * POST /mood/log — diary check-in (multiple per day allowed).
 * Rewards XP/gems/(optional item) at most once every 3 hours.
 */
router.post(
  '/log',
  protect,
  validate(logSchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as { timezone?: string }).timezone;
    const date = req.body.date ?? getTodayDateStr(timezone);
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : undefined;

    const reward = await tryGrantMoodDiaryReward(userId);

    const entry = await MoodLog.create({
      userId,
      date,
      mood: req.body.mood,
      note: note || undefined,
      rewarded: reward.rewarded,
    });

    success(
      res,
      {
        log: serializeLog(entry.toObject()),
        pet: reward.pet,
        xpGained: reward.xpGained,
        gemsAwarded: reward.gemsAwarded,
        item: reward.item,
        rewarded: reward.rewarded,
        nextAvailableAt: reward.nextAvailableAt,
      },
      201,
    );
  }),
);

/**
 * GET /mood/log — latest mood for a calendar day (compat with older clients).
 */
router.get(
  '/log',
  protect,
  validate(getDaySchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as { timezone?: string }).timezone;
    const date = (req.query as { date?: string }).date ?? getTodayDateStr(timezone);

    const log = await MoodLog.findOne({ userId, date }).sort({ createdAt: -1 }).lean();
    const status = await getMoodRewardStatus(userId);
    success(res, {
      log: log ? serializeLog(log) : null,
      nextAvailableAt: status.nextAvailableAt,
      canReward: status.canReward,
    });
  }),
);

/**
 * GET /mood/history — recent diary entries (newest first).
 */
router.get(
  '/history',
  protect,
  validate(historySchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const limit = (req.query as { limit?: number }).limit ?? 90;
    const logs = await MoodLog.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    const status = await getMoodRewardStatus(userId);
    success(res, {
      logs: logs.map(serializeLog),
      nextAvailableAt: status.nextAvailableAt,
      canReward: status.canReward,
    });
  }),
);

/**
 * GET /mood/status — reward cooldown + whether anything was logged today.
 */
router.get(
  '/status',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as { timezone?: string }).timezone;
    const today = getTodayDateStr(timezone);
    const [todayCount, latest, status] = await Promise.all([
      MoodLog.countDocuments({ userId, date: today }),
      MoodLog.findOne({ userId }).sort({ createdAt: -1 }).lean(),
      getMoodRewardStatus(userId),
    ]);
    success(res, {
      todayCount,
      latest: latest ? serializeLog(latest) : null,
      nextAvailableAt: status.nextAvailableAt,
      canReward: status.canReward,
    });
  }),
);

export default router;
