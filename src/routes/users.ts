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
import { PushToken } from '../models/PushToken.js';
import { AppError } from '../middleware/errorHandler.js';
import { checkAndGrant } from '../services/DailyLoginService.js';
import mongoose from 'mongoose';
import { Friend } from '../models/Friend.js';
import { Farm } from '../models/Farm.js';
import {
  createDefaultSkills,
  ensureUserSkills,
  syncPetTotalLevelFromSkills,
  toPublicSkills,
  totalSkillLevel,
} from '../services/SkillXpService.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { isStressBot } from '../services/stressBotIds.js';
import { UserEntity } from '../entities/UserEntity.js';

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
 * Returns the authenticated user's public profile (includes skills + average pet level).
 */
router.get(
  '/me',
  protect,
  catchAsync(async (req, res) => {
    const user = req.user;
    if (!user) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    success(res, await UserEntity.fromDoc(user).toPublic());
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
      const user = await User.findById(userId);
      if (!user) throw new AppError('User not found', 404);
      return success(res, await UserEntity.fromDoc(user).toPublic());
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true },
    );
    if (!updated) throw new AppError('User not found', 404);

    success(res, await UserEntity.fromDoc(updated).toPublic());
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

// ─── GET /users/:userId/public-profile ─────────────────────────────────────

const publicProfileSchema = {
  params: z.object({
    userId: z.string().min(1),
  }),
};

/**
 * Public companion + skills card for viewing another player (multiplayer, friends).
 * Includes friendship relation relative to the authenticated viewer.
 */
router.get(
  '/:userId/public-profile',
  protect,
  validate(publicProfileSchema),
  catchAsync(async (req, res) => {
    const meId = req.user?.id;
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const userId = String(req.params.userId);

    // Stress-test bots are synthetic presence — no User document.
    if (isStressBot(userId)) {
      const player = multiplayerManager.getInstanceForUser(userId)?.getPlayer(userId);
      if (!player) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      const skills = toPublicSkills(createDefaultSkills());
      return success(res, {
        id: userId,
        username: player.username,
        farmLevel: 1,
        totalLevel: 0,
        skills,
        friendship: { status: 'none' as const },
        pet: {
          name: player.petName,
          customName: player.petName,
          vibe: 'Bot',
          category: 'bot',
          imageUrl: player.petImageUrl,
          pose: player.petPose,
          hunger: 100,
          happy: 100,
          mood: 100,
          level: 0,
          totalLevel: 0,
          skills,
        },
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const doc = await User.findById(userId);
    if (!doc || !doc.pet) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const skills = ensureUserSkills(doc);
    syncPetTotalLevelFromSkills(doc);
    if (doc.isModified('skills') || doc.isModified('pet')) {
      await doc.save();
    }
    const publicSkills = toPublicSkills(skills);
    const totalLevel = totalSkillLevel(skills);

    const meOid = new mongoose.Types.ObjectId(meId);
    const themOid = new mongoose.Types.ObjectId(userId);
    const friendDoc =
      meId === userId
        ? null
        : await Friend.findOne({
            $or: [
              { fromUserId: meOid, toUserId: themOid },
              { fromUserId: themOid, toUserId: meOid },
            ],
            status: { $in: ['pending', 'accepted'] },
          }).lean();

    let friendship: {
      status: 'self' | 'none' | 'friends' | 'pending_outgoing' | 'pending_incoming';
      requestId?: string;
    } = { status: meId === userId ? 'self' : 'none' };

    if (friendDoc) {
      if (friendDoc.status === 'accepted') {
        friendship = { status: 'friends', requestId: friendDoc._id.toString() };
      } else if (friendDoc.fromUserId.toString() === meId) {
        friendship = { status: 'pending_outgoing', requestId: friendDoc._id.toString() };
      } else {
        friendship = { status: 'pending_incoming', requestId: friendDoc._id.toString() };
      }
    }

    const farm = await Farm.findOne({ userId }).select('farmLevel').lean();

    success(res, {
      id: doc._id.toString(),
      username: doc.username ?? undefined,
      farmLevel: farm?.farmLevel ?? 1,
      totalLevel,
      skills: publicSkills,
      friendship,
      pet: {
        name: doc.pet.name,
        customName: doc.pet.customName,
        vibe: doc.pet.vibe,
        category: doc.pet.category,
        baseColor: doc.pet.baseColor,
        secondaryColor: doc.pet.secondaryColor,
        imageUrl: doc.pet.imageUrl,
        pose: doc.pet.pose,
        hunger: doc.pet.hunger ?? 100,
        happy: doc.pet.happy ?? 100,
        mood: doc.pet.mood ?? 100,
        level: totalLevel,
        totalLevel,
        skills: publicSkills,
      },
    });
  }),
);

export default router;
