import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { OnboardingProfile } from '../models/OnboardingProfile.js';
import { WeightLog } from '../models/WeightLog.js';
import { User } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { PushToken } from '../models/PushToken.js';
import { AppError } from '../middleware/errorHandler.js';
import { checkAndGrant } from '../services/DailyLoginService.js';

const log = createLogger('UsersRoute');
const router = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const patchMeSchema = {
  body: z.object({
    theme: z.enum(['light', 'dark']).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }).strict(),
};

const pushTokenSchema = {
  body: z
    .object({
      token: z.string().min(10, 'Push token is required'),
      platform: z.enum(['ios', 'android']).optional(),
    })
    .strict(),
};

const onboardingSchema = {
  body: z.object({
    name: z.string().optional(),
    personalityVibe: z.string().optional(),
    companionStyle: z.string().optional(),
    gender: z.string().optional(),
    birthday: z.string().optional(),
    heightFeet: z.number().optional(),
    heightInches: z.number().optional(),
    currentWeight: z.number().optional(),
    goalWeight: z.number().optional(),
    activityLevel: z.string().optional(),
    goals: z.array(z.string()).optional(),
    dietary: z.array(z.string()).optional(),
  }).passthrough(),
};

/** Shared shape for both progress and full-save — plus the step tracker. */
const onboardingProgressSchema = {
  body: z.object({
    step: z.string().min(1),
    name: z.string().optional(),
    personalityVibe: z.string().optional(),
    companionStyle: z.string().optional(),
    gender: z.string().optional(),
    birthday: z.string().optional(),
    heightFeet: z.number().optional(),
    heightInches: z.number().optional(),
    currentWeight: z.number().optional(),
    goalWeight: z.number().optional(),
    activityLevel: z.string().optional(),
    goals: z.array(z.string()).optional(),
    dietary: z.array(z.string()).optional(),
  }).passthrough(),
};

// ─── POST /users/daily-login-rewards ────────────────────────────────────────

/**
 * First login of the day: places 2 fossil_holes on farm, generates AI greeting from yesterday's data.
 * Idempotent: if already rewarded today, returns empty. Client sends timezone for date calculation.
 */
const dailyLoginSchema = {
  body: z.object({
    timezone: z.string().optional(),
  }).strict(),
};

router.post(
  '/daily-login-rewards',
  protect,
  validate(dailyLoginSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const timezone = req.body?.timezone ?? req.user?.timezone;
    const result = await checkAndGrant(userId, timezone);

    success(res, { placedFossilHoles: !!result.greeting, greeting: result.greeting ?? undefined });
  }),
);

// ─── GET /users/me ──────────────────────────────────────────────────────────

/**
 * Returns the authenticated user's public profile.
 */
router.get(
  '/me',
  protect,
  catchAsync(async (req, res) => {
    const user = req.user;
    if (!user) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const sub = await Subscription.findOne({ userId: user.id });
    const subscription = sub
      ? { status: sub.status, plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd, trialEnd: sub.trialEnd }
      : null;

    success(res, {
      id: user.id,
      phone: user.phone,
      username: user.username,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      onboardingComplete: user.onboardingComplete,
      theme: user.theme ?? 'light',
      accentColor: user.accentColor ?? undefined,
      pet: user.pet ?? undefined,
      subscription,
    });
  }),
);

// ─── PATCH /users/me ────────────────────────────────────────────────────────

/**
 * Updates the authenticated user's profile (e.g. theme preference).
 */
router.patch(
  '/me',
  protect,
  validate(patchMeSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const updates: Record<string, unknown> = {};
    if (req.body.theme !== undefined) updates.theme = req.body.theme;
    if (req.body.accentColor !== undefined) updates.accentColor = req.body.accentColor;

    if (Object.keys(updates).length === 0) {
      const sub = await Subscription.findOne({ userId });
      const subscription = sub
        ? { status: sub.status, plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd, trialEnd: sub.trialEnd }
        : null;
      const user = await User.findById(userId);
      if (!user) throw new AppError('User not found', 404);
      return success(res, {
        id: user.id,
        phone: user.phone,
        username: user.username,
        role: user.role,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        onboardingComplete: user.onboardingComplete,
        theme: user.theme ?? 'light',
        accentColor: user.accentColor ?? undefined,
        pet: user.pet ?? undefined,
        subscription,
      });
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true },
    );
    if (!updated) throw new AppError('User not found', 404);

    const sub = await Subscription.findOne({ userId });
    const subscription = sub
      ? { status: sub.status, plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd, trialEnd: sub.trialEnd }
      : null;

    success(res, {
      id: updated.id,
      phone: updated.phone,
      username: updated.username,
      role: updated.role,
      lastLogin: updated.lastLogin,
      createdAt: updated.createdAt,
      onboardingComplete: updated.onboardingComplete,
      theme: updated.theme ?? 'light',
      accentColor: updated.accentColor ?? undefined,
      pet: updated.pet ?? undefined,
      subscription,
    });
  }),
);

// ─── POST /users/me/push-token ─────────────────────────────────────────────

/**
 * Registers or updates an Expo push token for the authenticated user.
 * Upserts by (userId, token) so one device is not duplicated.
 */
router.post(
  '/me/push-token',
  protect,
  validate(pushTokenSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { token, platform } = req.body;
    const trimmed = String(token).trim();

    if (!trimmed.startsWith('ExponentPushToken[') || !trimmed.endsWith(']')) {
      throw new AppError('Invalid Expo push token format', 400, 'INVALID_TOKEN');
    }

    await PushToken.findOneAndUpdate(
      { userId: req.user!._id, token: trimmed },
      { userId: req.user!._id, token: trimmed, platform },
      { upsert: true, new: true },
    );

    success(res, { registered: true }, 200);
  }),
);

// ─── GET /users/me/onboarding-progress ────────────────────────────────────

/**
 * Returns the saved onboarding profile for the authenticated user.
 * Used to hydrate the client-side OnboardingProvider on app relaunch so
 * the user can resume where they left off.
 */
router.get(
  '/me/onboarding-progress',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const profile = await OnboardingProfile.findOne({ userId }).lean();

    success(res, { profile: profile ?? null });
  }),
);

// ─── PATCH /users/me/onboarding-progress ──────────────────────────────────

/**
 * Incrementally saves onboarding answers as the user progresses through
 * each step. Fire-and-forget from the frontend — non-blocking.
 *
 * Records `lastStep` + `lastStepAt` so we can identify drop-off points.
 * Does **not** set `onboardingComplete`.
 */
router.patch(
  '/me/onboarding-progress',
  protect,
  validate(onboardingProgressSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { step, name, personalityVibe, companionStyle, gender, birthday,
      heightFeet, heightInches, currentWeight, goalWeight,
      activityLevel, goals, dietary } = req.body;

    log.info({ userId, step }, 'Onboarding progress checkpoint');

    const update: Record<string, unknown> = {
      userId,
      lastStep: step,
      lastStepAt: new Date(),
    };
    if (name !== undefined)            update.displayName = name;
    if (personalityVibe !== undefined)  update.personalityVibe = personalityVibe;
    if (companionStyle !== undefined)   update.companionStyle = companionStyle;
    if (gender !== undefined)           update.gender = gender;
    if (birthday !== undefined)         update.birthday = birthday;
    if (heightFeet !== undefined)       update.heightFeet = heightFeet;
    if (heightInches !== undefined)     update.heightInches = heightInches;
    if (currentWeight !== undefined)    update.currentWeight = currentWeight;
    if (goalWeight !== undefined)       update.goalWeight = goalWeight;
    if (activityLevel !== undefined)    update.activityLevel = activityLevel;
    if (goals !== undefined)            update.goals = goals;
    if (dietary !== undefined)          update.dietary = dietary;

    await OnboardingProfile.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true },
    );

    success(res, { step });
  }),
);

// ─── POST /users/me/onboarding ─────────────────────────────────────────────

/**
 * Saves all onboarding answers to a dedicated collection and marks the
 * user's onboarding as complete (`onboardingComplete: true`).
 *
 * Uses upsert so it can be called multiple times safely.
 * Also sets the user's display name (username) if provided.
 */
router.post(
  '/me/onboarding',
  protect,
  validate(onboardingSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const {
      name, personalityVibe, companionStyle, gender, birthday,
      heightFeet, heightInches, currentWeight, goalWeight,
      activityLevel, goals, dietary,
    } = req.body;

    log.info({ userId }, 'Saving onboarding profile and marking onboardingComplete');

    const profile = await OnboardingProfile.findOneAndUpdate(
      { userId },
      {
        userId,
        displayName: name ?? '',
        personalityVibe: personalityVibe ?? '',
        companionStyle: companionStyle ?? '',
        gender: gender ?? '',
        birthday: birthday ?? '',
        heightFeet: heightFeet ?? 0,
        heightInches: heightInches ?? 0,
        currentWeight: currentWeight ?? 0,
        goalWeight: goalWeight ?? 0,
        activityLevel: activityLevel ?? '',
        goals: goals ?? [],
        dietary: dietary ?? [],
      },
      { upsert: true, new: true, runValidators: true },
    );

    // Persist display name + flip onboardingComplete on the User document
    const userUpdate: Record<string, unknown> = { onboardingComplete: true };
    if (name) userUpdate.username = name;

    await User.findByIdAndUpdate(userId, { $set: userUpdate });

    log.info({ userId }, 'Onboarding profile saved, onboardingComplete set to true');

    // Seed the first weight log from onboarding (if provided and not already logged)
    if (currentWeight && currentWeight > 0) {
      const today = new Date().toISOString().slice(0, 10);
      await WeightLog.findOneAndUpdate(
        { userId, date: today },
        { userId, weight: currentWeight, date: today },
        { upsert: true, new: true },
      );
    }

    success(res, { profile });
  }),
);

export default router;
