import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { WeightLog } from '../models/WeightLog.js';
import { WeightGoal } from '../models/WeightGoal.js';
import { OnboardingProfile } from '../models/OnboardingProfile.js';
import { grantActionRewards } from '../services/ActionRewardService.js';
import { achievementService } from '../services/AchievementService.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('WeightRoute');
const router = Router();

/** Falls back to UTC if the client doesn't send a date. */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Activity multipliers (Mifflin-St Jeor) ─────────────────────────────────

const ACTIVITY_MULTIPLIER: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

/** Mifflin-St Jeor BMR → TDEE */
function computeTdee(
  weightLbs: number,
  heightFeet: number,
  heightInches: number,
  ageYears: number,
  gender: string,
  activityLevel: string,
): number {
  const weightKg = weightLbs * 0.453592;
  const heightCm = (heightFeet * 12 + heightInches) * 2.54;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr = gender === 'male' ? base + 5 : base - 161;
  const multiplier = ACTIVITY_MULTIPLIER[activityLevel] ?? 1.375;
  return Math.round(bmr * multiplier);
}

function ageFromBirthday(birthday: string): number {
  const bd = new Date(birthday);
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--;
  return Math.max(age, 13);
}

const MIN_DAILY_CAL = 1200;
const RATE_PRESETS = [0.5, 1.0, 1.5];

function buildRateOptions(
  currentWeight: number,
  goalWeight: number,
  tdee: number,
) {
  const diff = currentWeight - goalWeight;
  const isLoss = diff > 0;
  const absDiff = Math.abs(diff);

  return RATE_PRESETS.map((rate) => {
    const dailyDeficit = Math.round((rate * 3500) / 7);
    let daily = isLoss ? tdee - dailyDeficit : tdee + dailyDeficit;
    daily = Math.max(daily, MIN_DAILY_CAL);
    const weeks = absDiff > 0 ? Math.ceil(absDiff / rate) : 0;
    const safe = rate <= 2;
    return {
      weeklyRateLbs: +(isLoss ? -rate : rate).toFixed(1),
      dailyCalories: daily,
      estimatedWeeks: weeks,
      safe,
    };
  });
}

function computeGoalFromRate(
  weeklyRate: number,
  currentWeight: number,
  goalWeight: number,
  tdee: number,
) {
  const diff = currentWeight - goalWeight;
  const isLoss = diff > 0;
  const absRate = Math.abs(weeklyRate);
  const dailyDeficit = Math.round((absRate * 3500) / 7);
  let daily = isLoss ? tdee - dailyDeficit : tdee + dailyDeficit;
  daily = Math.max(daily, MIN_DAILY_CAL);
  const weeks = Math.abs(diff) > 0 ? Math.ceil(Math.abs(diff) / absRate) : 0;
  const months = Math.ceil(weeks / 4.345);
  return { dailyCalories: daily, timelineMonths: months, weeklyRateLbs: +(isLoss ? -absRate : absRate).toFixed(2) };
}

function computeGoalFromCalories(
  dailyCalories: number,
  currentWeight: number,
  goalWeight: number,
  tdee: number,
) {
  const diff = currentWeight - goalWeight;
  const isLoss = diff > 0;
  const deficit = Math.abs(tdee - dailyCalories);
  const weeklyRate = +((deficit * 7) / 3500).toFixed(2);
  const weeks = weeklyRate > 0 && Math.abs(diff) > 0 ? Math.ceil(Math.abs(diff) / weeklyRate) : 0;
  const months = Math.ceil(weeks / 4.345);
  return { dailyCalories: Math.max(dailyCalories, MIN_DAILY_CAL), timelineMonths: months, weeklyRateLbs: +(isLoss ? -weeklyRate : weeklyRate).toFixed(2) };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const logSchema = {
  body: z.object({
    weight: z.coerce.number().positive().max(1000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const updateSchema = {
  body: z.object({
    weight: z.coerce.number().positive().max(1000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const goalSchema = {
  body: z.object({
    weeklyRateLbs: z.coerce.number().min(0.1).max(3).optional(),
    dailyCalories: z.coerce.number().int().min(800).max(10000).optional(),
  }).refine((d) => d.weeklyRateLbs != null || d.dailyCalories != null, {
    message: 'Provide weeklyRateLbs or dailyCalories',
  }),
};

// ─── POST /weight/log — one per day, grants XP on first log ─────────────────

router.post(
  '/log',
  protect,
  validate(logSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const date = req.body.date ?? todayStr();
    const existing = await WeightLog.findOne({ userId, date });

    if (existing) {
      throw new AppError('Already logged weight today. Use PATCH to edit.', 409, 'WEIGHT_ALREADY_LOGGED');
    }

    const entry = await WeightLog.create({ userId, weight: req.body.weight, date });

    // Pet XP + gems (pass client date for accurate daily cap tracking)
    const { pet, xpGained, gemsAwarded } = await grantActionRewards(userId, 'weight', date);

    // Achievement checks
    const achievements = await achievementService.checkWeight(userId);

    log.info({ userId, weight: req.body.weight, date }, 'Weight logged');
    success(res, {
      log: entry,
      pet,
      xpGained,
      gemsAwarded,
      achievements: achievements.unlocked,
    }, 201);
  }),
);

// ─── PATCH /weight/log/today — edit today's entry ───────────────────────────

router.patch(
  '/log/today',
  protect,
  validate(updateSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const date = req.body.date ?? todayStr();
    const entry = await WeightLog.findOneAndUpdate(
      { userId, date },
      { $set: { weight: req.body.weight } },
      { new: true },
    );

    if (!entry) throw new AppError('No weight log for today', 404, 'NOT_FOUND');

    log.info({ userId, weight: req.body.weight }, 'Weight log updated');
    success(res, { log: entry });
  }),
);

// ─── GET /weight/log — recent history + stats ───────────────────────────────

router.get(
  '/log',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const raw = await WeightLog.find({ userId })
      .sort({ date: -1 })
      .lean();

    const logs = raw.map(({ _id, __v, ...rest }) => ({ id: _id.toString(), ...rest }));

    const today = (req.query as any).date ?? todayStr();
    const todayLog = logs.find((l) => l.date === today) ?? null;

    // Calculate weekly change
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentSorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const oldestThisWeek = recentSorted.find((l) => l.date >= weekAgo);
    const latest = logs[0] ?? null;

    let weeklyChange: number | null = null;
    if (latest && oldestThisWeek && latest.date !== oldestThisWeek.date) {
      weeklyChange = +(latest.weight - oldestThisWeek.weight).toFixed(1);
    }

    // Fallback: if no logs exist, pull onboarding weight as the baseline
    let onboardingWeight: number | null = null;
    let onboardingGoalWeight: number | null = null;
    if (!latest) {
      const profile = await OnboardingProfile.findOne({ userId }).lean();
      if (profile?.currentWeight && profile.currentWeight > 0) {
        onboardingWeight = profile.currentWeight;
      }
      if (profile?.goalWeight && profile.goalWeight > 0) {
        onboardingGoalWeight = profile.goalWeight;
      }
    }

    success(res, {
      logs,
      today: todayLog,
      latest,
      weeklyChange,
      onboardingWeight,
      onboardingGoalWeight,
    });
  }),
);

// ─── GET /weight/goal — current goal + TDEE + timeline options ──────────────

router.get(
  '/goal',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const profile = await OnboardingProfile.findOne({ userId }).lean();
    if (!profile) throw new AppError('Onboarding not complete', 400, 'NO_PROFILE');

    // Current weight: latest log or onboarding
    const latestLog = await WeightLog.findOne({ userId }).sort({ date: -1 }).lean();
    const currentWeight = latestLog?.weight ?? profile.currentWeight ?? 0;
    const goalWeight = profile.goalWeight ?? 0;

    if (!currentWeight || !goalWeight) {
      throw new AppError('Weight data missing', 400, 'WEIGHT_DATA_MISSING');
    }

    const age = profile.birthday ? ageFromBirthday(profile.birthday) : 25;
    const tdee = computeTdee(
      currentWeight,
      profile.heightFeet ?? 5,
      profile.heightInches ?? 8,
      age,
      profile.gender ?? 'female',
      profile.activityLevel ?? 'light',
    );

    const rateOptions = buildRateOptions(currentWeight, goalWeight, tdee);

    const goal = await WeightGoal.findOne({ userId }).lean();
    const goalOut = goal
      ? {
          id: (goal as any)._id.toString(),
          targetWeight: goal.targetWeight,
          timelineMonths: goal.timelineMonths,
          targetDate: goal.targetDate,
          tdee: goal.tdee,
          dailyCalories: goal.dailyCalories,
          weeklyRateLbs: goal.weeklyRateLbs,
        }
      : null;

    success(res, { goal: goalOut, tdee, currentWeight, goalWeight, rateOptions });
  }),
);

// ─── POST /weight/goal — create or update calorie goal ──────────────────────

router.post(
  '/goal',
  protect,
  validate(goalSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { weeklyRateLbs: rateInput, dailyCalories: calInput } = req.body;

    const profile = await OnboardingProfile.findOne({ userId }).lean();
    if (!profile) throw new AppError('Onboarding not complete', 400, 'NO_PROFILE');

    const latestLog = await WeightLog.findOne({ userId }).sort({ date: -1 }).lean();
    const currentWeight = latestLog?.weight ?? profile.currentWeight ?? 0;
    const goalWeight = profile.goalWeight ?? 0;

    if (!currentWeight || !goalWeight) {
      throw new AppError('Weight data missing', 400, 'WEIGHT_DATA_MISSING');
    }

    const age = profile.birthday ? ageFromBirthday(profile.birthday) : 25;
    const tdee = computeTdee(
      currentWeight,
      profile.heightFeet ?? 5,
      profile.heightInches ?? 8,
      age,
      profile.gender ?? 'female',
      profile.activityLevel ?? 'light',
    );

    let computed: { dailyCalories: number; timelineMonths: number; weeklyRateLbs: number };
    if (rateInput != null) {
      computed = computeGoalFromRate(rateInput, currentWeight, goalWeight, tdee);
    } else {
      computed = computeGoalFromCalories(calInput!, currentWeight, goalWeight, tdee);
    }

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + computed.timelineMonths);

    const goal = await WeightGoal.findOneAndUpdate(
      { userId },
      {
        userId,
        targetWeight: goalWeight,
        timelineMonths: computed.timelineMonths,
        targetDate,
        tdee,
        dailyCalories: computed.dailyCalories,
        weeklyRateLbs: computed.weeklyRateLbs,
      },
      { upsert: true, new: true },
    );

    log.info({ userId, dailyCalories: computed.dailyCalories, weeklyRateLbs: computed.weeklyRateLbs }, 'Weight goal set');

    success(res, {
      goal: {
        id: goal._id.toString(),
        targetWeight: goal.targetWeight,
        timelineMonths: goal.timelineMonths,
        targetDate: goal.targetDate,
        tdee: goal.tdee,
        dailyCalories: goal.dailyCalories,
        weeklyRateLbs: goal.weeklyRateLbs,
      },
    });
  }),
);

export default router;
