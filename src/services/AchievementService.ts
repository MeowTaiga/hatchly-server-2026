import { Achievement } from '../models/Achievement.js';
import { FoodLog } from '../models/FoodLog.js';
import { WaterLog } from '../models/WaterLog.js';
import { WeightLog } from '../models/WeightLog.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, type AchievementKey } from '../constants/achievements.js';
import { petService } from './PetService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('AchievementService');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UnlockedAchievement {
  achievementId: string;
  title: string;
  description: string;
  message: string;
  icon: string;
  xpReward: number;
}

export interface AchievementCheckResult {
  /** Newly unlocked achievements (empty if none) */
  unlocked: UnlockedAchievement[];
  /** Total bonus XP awarded from achievements */
  totalXpFromAchievements: number;
}

// ─── Milestone thresholds ───────────────────────────────────────────────────

const FOOD_MILESTONES: [number, AchievementKey][] = [
  [1,    'FIRST_FOOD_LOG'],
  [10,   'FOOD_LOGS_10'],
  [50,   'FOOD_LOGS_50'],
  [100,  'FOOD_LOGS_100'],
  [250,  'FOOD_LOGS_250'],
  [500,  'FOOD_LOGS_500'],
  [1000, 'FOOD_LOGS_1000'],
];

const WATER_MILESTONES: [number, AchievementKey][] = [
  [1,   'FIRST_WATER_LOG'],
  [10,  'WATER_LOGS_10'],
  [50,  'WATER_LOGS_50'],
  [100, 'WATER_LOGS_100'],
  [500, 'WATER_LOGS_500'],
];

const WEIGHT_MILESTONES: [number, AchievementKey][] = [
  [1,   'FIRST_WEIGHT_LOG'],
  [7,   'WEIGHT_LOGS_7'],
  [30,  'WEIGHT_LOGS_30'],
  [100, 'WEIGHT_LOGS_100'],
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Try to grant a single achievement. Returns the unlocked info if newly
 * granted, or null if the user already has it.
 */
async function tryGrant(
  userId: string,
  key: AchievementKey,
): Promise<UnlockedAchievement | null> {
  const def = ACHIEVEMENTS[key];
  if (!def) return null;

  try {
    await Achievement.create({ userId, achievementId: def.id });
  } catch (err: any) {
    // Duplicate key = already earned → skip silently
    if (err.code === 11000) return null;
    throw err;
  }

  log.info({ userId, achievement: def.id }, 'Achievement unlocked');
  return {
    achievementId: def.id,
    title: def.title,
    description: def.description,
    message: def.message,
    icon: def.icon,
    xpReward: def.xpReward,
  };
}

/**
 * Check a list of milestones against a count and grant any that apply.
 */
async function checkMilestones(
  userId: string,
  count: number,
  milestones: [number, AchievementKey][],
): Promise<UnlockedAchievement[]> {
  const unlocked: UnlockedAchievement[] = [];

  for (const [threshold, key] of milestones) {
    if (count >= threshold) {
      const result = await tryGrant(userId, key);
      if (result) unlocked.push(result);
    }
  }

  return unlocked;
}

/**
 * Award bonus XP for each newly unlocked achievement.
 */
async function rewardXp(
  userId: string,
  unlocked: UnlockedAchievement[],
): Promise<number> {
  let total = 0;
  for (const a of unlocked) {
    if (a.xpReward > 0) {
      await petService.grantBonusXP(userId, a.xpReward, `achievement:${a.achievementId}`);
      total += a.xpReward;
    }
  }
  return total;
}

// ─── Public Service ─────────────────────────────────────────────────────────

/**
 * Central achievement controller.
 *
 * Usage from any route:
 * ```ts
 * const result = await achievementService.checkFood(userId);
 * // result.unlocked — array of newly unlocked achievements
 * ```
 */
export const achievementService = {
  /**
   * Grant a specific achievement by key.
   *
   * ```ts
   * await achievementService.grant(userId, 'FIRST_FOOD_LOG');
   * ```
   */
  async grant(
    userId: string,
    key: AchievementKey,
  ): Promise<AchievementCheckResult> {
    const result = await tryGrant(userId, key);
    const unlocked = result ? [result] : [];
    const totalXpFromAchievements = await rewardXp(userId, unlocked);
    return { unlocked, totalXpFromAchievements };
  },

  /**
   * Check all food-related milestones after a food log.
   * Counts total food logs for the user and grants any matching achievements.
   */
  async checkFood(userId: string): Promise<AchievementCheckResult> {
    const count = await FoodLog.countDocuments({ userId });
    const unlocked = await checkMilestones(userId, count, FOOD_MILESTONES);
    const totalXpFromAchievements = await rewardXp(userId, unlocked);
    return { unlocked, totalXpFromAchievements };
  },

  /**
   * Check all water-related milestones after a water log.
   */
  async checkWater(userId: string): Promise<AchievementCheckResult> {
    const count = await WaterLog.countDocuments({ userId });
    const unlocked = await checkMilestones(userId, count, WATER_MILESTONES);
    const totalXpFromAchievements = await rewardXp(userId, unlocked);
    return { unlocked, totalXpFromAchievements };
  },

  /**
   * Check all weight-related milestones after a weight log.
   */
  async checkWeight(userId: string): Promise<AchievementCheckResult> {
    const count = await WeightLog.countDocuments({ userId });
    const unlocked = await checkMilestones(userId, count, WEIGHT_MILESTONES);
    const totalXpFromAchievements = await rewardXp(userId, unlocked);
    return { unlocked, totalXpFromAchievements };
  },

  /**
   * Get all achievements a user has unlocked.
   */
  async getUserAchievements(userId: string) {
    const docs = await Achievement.find({ userId }).sort({ unlockedAt: -1 }).lean();

    return docs.map((doc) => {
      const def = ACHIEVEMENT_BY_ID.get(doc.achievementId);
      return {
        id: (doc as any)._id.toString(),
        achievementId: doc.achievementId,
        title: def?.title ?? doc.achievementId,
        description: def?.description ?? '',
        category: def?.category ?? 'general',
        icon: def?.icon ?? '🏅',
        xpReward: def?.xpReward ?? 0,
        unlockedAt: doc.unlockedAt,
      };
    });
  },

  /**
   * Get all available achievements with unlock status for a user.
   */
  async getAllWithStatus(userId: string) {
    const unlocked = await Achievement.find({ userId }).lean();
    const unlockedSet = new Set(unlocked.map((a) => a.achievementId));

    return Object.values(ACHIEVEMENTS).map((def) => ({
      achievementId: def.id,
      title: def.title,
      description: def.description,
      category: def.category,
      icon: def.icon,
      xpReward: def.xpReward,
      unlocked: unlockedSet.has(def.id),
      unlockedAt: unlocked.find((a) => a.achievementId === def.id)?.unlockedAt ?? null,
    }));
  },
};
