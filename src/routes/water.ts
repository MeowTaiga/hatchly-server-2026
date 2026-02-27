import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { WaterLog } from '../models/WaterLog.js';
import { WeightLog } from '../models/WeightLog.js';
import { OnboardingProfile } from '../models/OnboardingProfile.js';
import { grantActionRewards } from '../services/ActionRewardService.js';
import { achievementService } from '../services/AchievementService.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('WaterRoute');
const router = Router();

const MIN_WATER_GOAL_OZ = 48;
const MAX_WATER_GOAL_OZ = 160;

/** Falls back to UTC if the client doesn't send a date. */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getWaterGoalFromWeight(weightLbs: number | null): number {
  if (!weightLbs || weightLbs <= 0) return 64;
  const computed = Math.round(weightLbs * 0.5);
  return Math.max(MIN_WATER_GOAL_OZ, Math.min(MAX_WATER_GOAL_OZ, computed));
}

const logSchema = {
  body: z.object({
    amountOz: z.coerce.number().positive().max(512),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const logQuerySchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const logRangeQuerySchema = {
  query: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
};

router.post(
  '/log',
  protect,
  validate(logSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const date = req.body.date ?? todayStr();
    const entry = await WaterLog.create({ userId, amountOz: req.body.amountOz, date });

    // Pet XP + gems (pass client date for accurate daily cap tracking)
    const { pet, xpGained, gemsAwarded } = await grantActionRewards(userId, 'water', date);

    // Achievement checks
    const achievements = await achievementService.checkWater(userId);

    log.info({ userId, amountOz: req.body.amountOz }, 'Water logged');
    success(res, {
      log: entry,
      pet,
      xpGained,
      gemsAwarded,
      achievements: achievements.unlocked,
    }, 201);
  }),
);

router.get(
  '/log/range',
  protect,
  validate(logRangeQuerySchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { start, end } = req.query as { start: string; end: string };
    if (start > end) throw new AppError('start must be <= end', 400, 'INVALID_RANGE');
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (daysDiff > 31) throw new AppError('Range cannot exceed 31 days', 400, 'RANGE_TOO_LARGE');

    const raw = await WaterLog.find({ userId, date: { $gte: start, $lte: end } })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    const byDate = new Map<string, { totalOz: number; logs: any[] }>();
    for (const l of raw) {
      if (!byDate.has(l.date)) byDate.set(l.date, { totalOz: 0, logs: [] });
      const entry = byDate.get(l.date)!;
      entry.totalOz += l.amountOz;
      const { _id, __v, ...rest } = l as any;
      entry.logs.push({ id: _id.toString(), ...rest });
    }

    const daily = Array.from({ length: daysDiff }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const data = byDate.get(dateStr);
      return {
        date: dateStr,
        totalOz: data ? Math.round(data.totalOz * 10) / 10 : 0,
        logs: data?.logs ?? [],
      };
    });

    const latestWeight = await WeightLog.findOne({ userId })
      .sort({ date: -1 })
      .select('weight')
      .lean();
    const onboarding = latestWeight
      ? null
      : await OnboardingProfile.findOne({ userId }).select('currentWeight').lean();
    const weightForGoal = latestWeight?.weight ?? onboarding?.currentWeight ?? null;
    const goalOz = getWaterGoalFromWeight(weightForGoal);

    log.info({ userId, start, end, days: daily.length }, 'Water log range fetched');
    success(res, { daily, goalOz, goalSourceWeightLbs: weightForGoal });
  }),
);

router.get(
  '/log',
  protect,
  validate(logQuerySchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const dateStr = (req.query as any).date ?? todayStr();
    const raw = await WaterLog.find({ userId, date: dateStr })
      .sort({ createdAt: -1 })
      .lean();

    const logs = raw.map(({ _id, __v, ...rest }) => ({ id: _id.toString(), ...rest }));
    const totalOz = logs.reduce((sum, l) => sum + l.amountOz, 0);

    const latestWeight = await WeightLog.findOne({ userId })
      .sort({ date: -1 })
      .select('weight')
      .lean();
    const onboarding = latestWeight
      ? null
      : await OnboardingProfile.findOne({ userId }).select('currentWeight').lean();
    const weightForGoal = latestWeight?.weight ?? onboarding?.currentWeight ?? null;
    const goalOz = getWaterGoalFromWeight(weightForGoal);

    success(res, {
      logs,
      totalOz: Math.round(totalOz * 10) / 10,
      goalOz,
      goalSourceWeightLbs: weightForGoal,
      date: dateStr,
    });
  }),
);

export default router;
