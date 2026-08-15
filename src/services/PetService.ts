import { User, type IUserPet } from '../models/User.js';
import { DailyXpLog } from '../models/DailyXpLog.js';
import { PetPetLog } from '../models/PetPetLog.js';
import { SKILL_XP_REWARDS, type SkillId } from '../constants/skills.js';
import {
  ensureUserSkills,
  skillXpService,
  syncPetTotalLevelFromSkills,
  toPublicSkills,
  totalSkillLevel,
  type PublicSkills,
} from './SkillXpService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PetService');

// ─── Legacy action keys (wellness logs) ──────────────────────────────────────

/** Maps wellness log actions → health skill XP amounts. */
export const XP_REWARDS = {
  food: SKILL_XP_REWARDS.health_food,
  water: SKILL_XP_REWARDS.health_water,
  weight: SKILL_XP_REWARDS.health_weight,
  pet: SKILL_XP_REWARDS.pet_pet,
  mood: SKILL_XP_REWARDS.health_mood,
} as const;

/** Max pets per hour before over-petting (sour mood, no XP). */
export const PET_PET_LIMIT_PER_HOUR = 3;

/** Max XP-eligible health actions per day per category */
const DAILY_XP_CAPS: Record<string, number> = {
  food: 3,
  water: 1,
  weight: 1,
  mood: 1,
};

export type XpAction = keyof typeof XP_REWARDS;

// ─── Sanitised pet for API responses ────────────────────────────────────────

export interface PublicPet {
  name: string;
  customName: string;
  vibe: string;
  category: string;
  /** Primary colour hex used when generating the pet. */
  baseColor?: string;
  /** Secondary colour hex used when generating the pet. */
  secondaryColor?: string;
  imageUrl: string;
  pose?: Record<string, string>;
  hunger: number;
  happy: number;
  mood: number;
  /** Average skill level (floor of mean of all skills). */
  level: number;
  /** @deprecated Always 0 — use skills[].xp */
  xp: number;
  /** @deprecated Always 1 — use skills[].xpToNextLevel */
  xpToNextLevel: number;
  skills?: PublicSkills;
  totalLevel?: number;
}

function toPublicPet(pet: IUserPet, skills?: PublicSkills): PublicPet {
  const totalLevel = skills ? totalSkillLevel(skills) : pet.level;
  return {
    name: pet.name,
    customName: pet.customName,
    vibe: pet.vibe,
    category: pet.category,
    baseColor: pet.baseColor,
    secondaryColor: pet.secondaryColor,
    imageUrl: pet.imageUrl,
    pose: pet.pose,
    hunger: pet.hunger ?? 100,
    happy: pet.happy ?? 100,
    mood: pet.mood ?? 100,
    level: totalLevel,
    xp: 0,
    xpToNextLevel: 1,
    skills,
    totalLevel,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

/** Calendar date in the user's timezone (falls back to UTC). Server-owned for XP caps. */
function todayStrForTimezone(timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Central pet / wellness XP controller.
 * Care actions grant **health** (or **social**) skill XP; `pet.level` = average skill level.
 */
export const petService = {
  /**
   * Award health skill XP for a wellness log. Respects daily caps.
   * Cap date is always derived server-side (user timezone) — client dates are ignored.
   */
  async gainXP(
    userId: string,
    action: XpAction,
    overrideAmount?: number,
    _clientDate?: string,
  ): Promise<{ pet: PublicPet | null; xpGained: number }> {
    const amount = overrideAmount ?? XP_REWARDS[action];
    const user = await User.findById(userId);
    if (!user?.pet) {
      return { pet: null, xpGained: 0 };
    }

    // Cap date is server-derived from the account timezone — never trust client dates.
    const date = todayStrForTimezone(user.timezone);
    const cap = DAILY_XP_CAPS[action] ?? Infinity;

    const counter = await DailyXpLog.findOneAndUpdate(
      { userId, date, action },
      { $inc: { count: 1 } },
      { upsert: true, new: true },
    );

    const withinCap = counter.count <= cap;

    const skills = ensureUserSkills(user);
    const publicSkills = toPublicSkills(skills);
    syncPetTotalLevelFromSkills(user);

    if (!withinCap) {
      log.info({ userId, action, count: counter.count, cap }, 'Daily XP cap reached — no XP awarded');
      if (user.isModified('skills') || user.isModified('pet')) await user.save();
      return { pet: toPublicPet(user.pet, publicSkills), xpGained: 0 };
    }

    // Persist skill grant (reloads user — ok)
    const grant = await skillXpService.grant(userId, 'health', amount);
    const refreshed = await User.findById(userId);
    if (!refreshed?.pet) return { pet: null, xpGained: 0 };

    log.info({ userId, action, amount, totalLevel: grant?.totalLevel }, 'Health skill XP gained');
    return {
      pet: toPublicPet(refreshed.pet, grant?.skills),
      xpGained: amount,
    };
  },

  /**
   * Award skill XP directly (e.g. achievements). Defaults to **social**.
   * Bypasses daily caps — use sparingly.
   */
  async grantBonusXP(
    userId: string,
    amount: number,
    reason: string,
    skill: SkillId = 'social',
  ): Promise<{
    pet: PublicPet | null;
    xpGained: number;
    skills?: PublicSkills;
    totalLevel?: number;
  }> {
    const grant = await skillXpService.grant(userId, skill, amount);
    if (!grant) return { pet: null, xpGained: 0 };

    const user = await User.findById(userId).select('pet').lean();
    if (!user?.pet) return { pet: null, xpGained: 0, skills: grant.skills, totalLevel: grant.totalLevel };

    log.info({ userId, amount, reason, skill, totalLevel: grant.totalLevel }, 'Bonus skill XP granted');
    return {
      pet: toPublicPet(user.pet as IUserPet, grant.skills),
      xpGained: amount,
      skills: grant.skills,
      totalLevel: grant.totalLevel,
    };
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
    const skills = ensureUserSkills(user);
    syncPetTotalLevelFromSkills(user);
    user.markModified('pet');
    await user.save();

    log.info({ userId, mood: user.pet.mood, delta: amount }, 'Pet mood raised from farm action');
    return toPublicPet(user.pet, toPublicSkills(skills));
  },

  /** Get the current pet state without modifying anything */
  async getPet(userId: string): Promise<PublicPet | null> {
    const snapshot = await skillXpService.getSkills(userId);
    const user = await User.findById(userId).select('pet').lean();
    if (!user?.pet) return null;
    return toPublicPet(user.pet as IUserPet, snapshot?.skills);
  },

  /**
   * Pet interaction: awards **social** XP, updates happy/mood. Max 3/hour.
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

    const skills = ensureUserSkills(user);

    if (overPet) {
      user.pet.happy = Math.max(0, (user.pet.happy ?? 100) - HAPPY_LOSS);
      user.pet.mood = Math.max(0, (user.pet.mood ?? 100) - MOOD_LOSS);
      syncPetTotalLevelFromSkills(user);
      user.markModified('pet');
      await user.save();
      log.info({ userId, happy: user.pet.happy, mood: user.pet.mood }, 'Over-pet: mood sour');
      return { pet: toPublicPet(user.pet, toPublicSkills(skills)), xpGained: 0, overPet: true };
    }

    user.pet.happy = Math.min(100, (user.pet.happy ?? 100) + HAPPY_GAIN);
    user.pet.mood = Math.min(100, (user.pet.mood ?? 100) + 1);
    syncPetTotalLevelFromSkills(user);
    user.markModified('pet');
    await user.save();

    const grant = await skillXpService.grant(userId, 'social', XP_REWARDS.pet);
    const refreshed = await User.findById(userId).select('pet').lean();
    log.info({ userId, xp: XP_REWARDS.pet, totalLevel: grant?.totalLevel }, 'Pet petted (social XP)');
    return {
      pet: refreshed?.pet
        ? toPublicPet(refreshed.pet as IUserPet, grant?.skills)
        : toPublicPet(user.pet, grant?.skills),
      xpGained: XP_REWARDS.pet,
      overPet: false,
    };
  },
};
