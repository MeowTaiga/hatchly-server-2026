import { User, type IUser, type IUserPet } from '../models/User.js';
import { DailyXpLog } from '../models/DailyXpLog.js';
import { PetPetLog } from '../models/PetPetLog.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PetService');

// ─── XP Config ──────────────────────────────────────────────────────────────

/** XP awarded per action type */
export const XP_REWARDS = {
  food:   15,
  water:  5,
  weight: 10,
  pet:    10,
  mood:   10,
} as const;

/** Max pets per hour before over-petting (sour mood, no XP). */
export const PET_PET_LIMIT_PER_HOUR = 3;

/** Max XP-eligible actions per day per category */
const DAILY_XP_CAPS: Record<string, number> = {
  food:   3,
  water:  1,
  weight: 1,
  mood:   1,
};

export type XpAction = keyof typeof XP_REWARDS;

// ─── Sanitised pet for API responses ────────────────────────────────────────

export interface PublicPet {
  name: string;
  customName: string;
  vibe: string;
  category: string;
  imageUrl: string;
  pose?: Record<string, string>;
  hunger: number;
  happy: number;
  mood: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
}

function toPublicPet(pet: IUserPet): PublicPet {
  return {
    name: pet.name,
    customName: pet.customName,
    vibe: pet.vibe,
    category: pet.category,
    imageUrl: pet.imageUrl,
    pose: pet.pose,
    hunger: pet.hunger ?? 100,
    happy: pet.happy ?? 100,
    mood: pet.mood ?? 100,
    level: pet.level,
    xp: pet.xp,
    xpToNextLevel: pet.xpToNextLevel,
  };
}

// ─── Core levelling math ────────────────────────────────────────────────────

function applyXp(pet: IUserPet, amount: number): void {
  pet.xp += amount;
  while (pet.xp >= pet.xpToNextLevel) {
    pet.xp -= pet.xpToNextLevel;
    pet.level += 1;
    pet.xpToNextLevel = Math.ceil(pet.xpToNextLevel * 1.25);
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Central pet XP controller.
 *
 * Usage from any route:
 * ```ts
 * const result = await petService.gainXP(userId, 'food');
 * // result.pet   — updated pet object for the response
 * // result.xpGained — how much XP was actually awarded (0 if capped)
 * ```
 */
export const petService = {
  /**
   * Award XP for an action. Respects daily caps.
   * Returns the updated pet and the actual XP gained (0 if daily cap hit).
   */
  async gainXP(
    userId: string,
    action: XpAction,
    overrideAmount?: number,
    clientDate?: string,
  ): Promise<{ pet: PublicPet | null; xpGained: number }> {
    const amount = overrideAmount ?? XP_REWARDS[action];
    const date = clientDate ?? todayStr();
    const cap = DAILY_XP_CAPS[action] ?? Infinity;

    // ── Check / increment daily counter ─────────────────────────────────
    const counter = await DailyXpLog.findOneAndUpdate(
      { userId, date, action },
      { $inc: { count: 1 } },
      { upsert: true, new: true },
    );

    const withinCap = counter.count <= cap;

    // ── Load user + pet ─────────────────────────────────────────────────
    const user = await User.findById(userId);
    if (!user?.pet) {
      return { pet: null, xpGained: 0 };
    }

    if (!withinCap) {
      log.info({ userId, action, count: counter.count, cap }, 'Daily XP cap reached — no XP awarded');
      return { pet: toPublicPet(user.pet), xpGained: 0 };
    }

    applyXp(user.pet, amount);
    user.markModified('pet');
    await user.save();

    log.info({ userId, action, amount, level: user.pet.level }, 'Pet XP gained');
    return { pet: toPublicPet(user.pet), xpGained: amount };
  },

  /**
   * Award a flat XP amount directly (e.g. from achievement rewards).
   * Bypasses daily caps — use sparingly.
   */
  async grantBonusXP(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<{ pet: PublicPet | null; xpGained: number }> {
    const user = await User.findById(userId);
    if (!user?.pet) return { pet: null, xpGained: 0 };

    applyXp(user.pet, amount);
    user.markModified('pet');
    await user.save();

    log.info({ userId, amount, reason, level: user.pet.level }, 'Bonus XP granted');
    return { pet: toPublicPet(user.pet), xpGained: amount };
  },

  /**
   * Raise pet mood when the user performs a farm action (planting, placing decoration).
   * Does not award XP; mood only. Returns updated pet for client sync.
   */
  async raiseMoodFromFarmAction(userId: string, amount: number = 2): Promise<PublicPet | null> {
    const user = await User.findById(userId);
    if (!user?.pet) return null;

    const current = user.pet.mood ?? 100;
    user.pet.mood = Math.min(100, current + amount);
    user.markModified('pet');
    await user.save();

    log.info({ userId, mood: user.pet.mood, delta: amount }, 'Pet mood raised from farm action');
    return toPublicPet(user.pet);
  },

  /** Get the current pet state without modifying anything */
  async getPet(userId: string): Promise<PublicPet | null> {
    const user = await User.findById(userId).select('pet').lean();
    return user?.pet ? toPublicPet(user.pet as IUserPet) : null;
  },

  /**
   * Pet interaction: awards XP, updates happy/mood. Max 3/hour.
   * Over-petting: no XP, happiness and mood decrease.
   */
  async pet(userId: string): Promise<{ pet: PublicPet | null; xpGained: number; overPet: boolean }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await PetPetLog.countDocuments({
      userId,
      createdAt: { $gte: oneHourAgo },
    });

    const user = await User.findById(userId);
    if (!user?.pet) return { pet: null, xpGained: 0, overPet: false };

    await PetPetLog.create({ userId });

    const overPet = recentCount >= PET_PET_LIMIT_PER_HOUR;
    const HAPPY_GAIN = 3;
    const HAPPY_LOSS = 5;
    const MOOD_LOSS = 8;

    if (overPet) {
      user.pet.happy = Math.max(0, (user.pet.happy ?? 100) - HAPPY_LOSS);
      user.pet.mood = Math.max(0, (user.pet.mood ?? 100) - MOOD_LOSS);
      user.markModified('pet');
      await user.save();
      log.info({ userId, happy: user.pet.happy, mood: user.pet.mood }, 'Over-pet: mood sour');
      return { pet: toPublicPet(user.pet), xpGained: 0, overPet: true };
    }

    applyXp(user.pet, XP_REWARDS.pet);
    user.pet.happy = Math.min(100, (user.pet.happy ?? 100) + HAPPY_GAIN);
    user.pet.mood = Math.min(100, (user.pet.mood ?? 100) + 1);
    user.markModified('pet');
    await user.save();
    log.info({ userId, xp: XP_REWARDS.pet, level: user.pet.level }, 'Pet petted');
    return { pet: toPublicPet(user.pet), xpGained: XP_REWARDS.pet, overPet: false };
  },
};
