/**
 * Skill XP service — RuneScape-style per-skill levels with a power curve.
 *
 * Easy grant API for any system:
 * ```ts
 * await skillXpService.grant(userId, 'farming', 12);
 * await skillXpService.grant(userId, 'health', SKILL_XP_REWARDS.health_food);
 * ```
 *
 * `pet.level` is kept in sync as the average of all skill levels.
 */

import { User, type IUser, type ISkillProgress, type IUserSkills } from '../models/User.js';
import {
  SKILL_IDS,
  MAX_SKILL_LEVEL,
  MAX_SKILL_XP_GRANT,
  SKILL_XP_REWARDS,
  isSkillId,
  type SkillId,
  type SkillXpRewardKey,
  xpToNextSkillLevel,
} from '../constants/skills.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('SkillXpService');

export interface PublicSkillProgress {
  level: number;
  xp: number;
  xpToNextLevel: number;
}

export type PublicSkills = Record<SkillId, PublicSkillProgress>;

export interface SkillGrantResult {
  skill: SkillId;
  amount: number;
  levelsGained: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
}

export interface SkillItemReward {
  itemType: string;
  qty: number;
}

export interface SkillXpGrantResult {
  skills: PublicSkills;
  totalLevel: number;
  gained: SkillGrantResult[];
  /** Crafting recipes newly written to the journal from this grant. */
  unlockedRecipes?: string[];
  /** Item rewards granted by skill milestones (e.g. farming soil). */
  itemRewards?: SkillItemReward[];
  inventory?: Record<string, number>;
  storage?: Record<string, number>;
}

/** Compact payload folded into game:state_update for HUD sync + XP feedback. */
export interface SkillXpStatePayload {
  skill: SkillId;
  amount: number;
  levelsGained: number;
  level: number;
  totalLevel: number;
  skills: PublicSkills;
  /** Crafting journal recipes unlocked by this grant (if any). */
  unlockedRecipes?: string[];
  /** Item rewards from skill milestones. */
  itemRewards?: SkillItemReward[];
}

/** Convert a grant result into a state-update field (first packet if many). */
export function toSkillXpPayload(
  result: SkillXpGrantResult | null | undefined,
): SkillXpStatePayload | undefined {
  if (!result?.gained.length) return undefined;
  const g = result.gained[0];
  return {
    skill: g.skill,
    amount: result.gained.reduce((sum, row) => sum + row.amount, 0),
    levelsGained: result.gained.reduce((sum, row) => sum + row.levelsGained, 0),
    level: g.level,
    totalLevel: result.totalLevel,
    skills: result.skills,
    ...(result.unlockedRecipes?.length
      ? { unlockedRecipes: result.unlockedRecipes }
      : {}),
    ...(result.itemRewards?.length ? { itemRewards: result.itemRewards } : {}),
  };
}

/** Attach skill XP onto any state-update-shaped object. */
export function attachSkillXp<
  T extends {
    skillXp?: SkillXpStatePayload;
    inventory?: Record<string, number>;
    storage?: Record<string, number>;
  },
>(update: T, result: SkillXpGrantResult | null | undefined): T {
  const skillXp = toSkillXpPayload(result);
  if (skillXp) update.skillXp = skillXp;
  if (result?.inventory) update.inventory = result.inventory;
  if (result?.storage) update.storage = result.storage;
  return update;
}

function emptySkill(): ISkillProgress {
  return { level: 0, xp: 0 };
}

export function createDefaultSkills(): IUserSkills {
  const skills = {} as IUserSkills;
  for (const id of SKILL_IDS) skills[id] = emptySkill();
  return skills;
}

/** Companion / pet level: floor of the mean of every skill (missing skills count as 0). */
export function totalSkillLevel(skills: IUserSkills | PublicSkills | null | undefined): number {
  if (!skills) return 0;
  let total = 0;
  for (const id of SKILL_IDS) {
    total += skills[id]?.level ?? 0;
  }
  return Math.floor(total / SKILL_IDS.length);
}

export function toPublicSkills(skills: IUserSkills): PublicSkills {
  const out = {} as PublicSkills;
  for (const id of SKILL_IDS) {
    const s = skills[id] ?? emptySkill();
    const level = Math.min(MAX_SKILL_LEVEL, Math.max(0, s.level ?? 0));
    out[id] = {
      level,
      xp: Math.max(0, s.xp ?? 0),
      xpToNextLevel: xpToNextSkillLevel(level),
    };
  }
  return out;
}

/** Ensure every skill key exists on the user document (mutates in place). */
export function ensureUserSkills(user: IUser): IUserSkills {
  if (!user.skills) {
    user.skills = createDefaultSkills();
  } else {
    for (const id of SKILL_IDS) {
      if (!user.skills[id]) user.skills[id] = emptySkill();
      if (user.skills[id].level < 0) user.skills[id].level = 0;
      if (user.skills[id].xp < 0) user.skills[id].xp = 0;
    }
  }
  return user.skills;
}

/**
 * Apply XP onto a plain snapshot and return the next level/xp.
 * Important: do NOT mutate Mongoose SingleNested subdocs in place after
 * reassignment — `skills[id] = skills[id]` detaches the doc and XP is lost.
 */
function applySkillXpTo(
  current: { level?: number; xp?: number } | null | undefined,
  amount: number,
): { level: number; xp: number; levelsGained: number } {
  let level = Math.min(MAX_SKILL_LEVEL, Math.max(0, Math.floor(current?.level ?? 0)));
  let xp = Math.max(0, Math.floor(Number(current?.xp) || 0));
  let levelsGained = 0;

  if (amount <= 0 || level >= MAX_SKILL_LEVEL) {
    return { level, xp, levelsGained: 0 };
  }

  xp += Math.floor(amount);
  while (level < MAX_SKILL_LEVEL) {
    const need = xpToNextSkillLevel(level);
    if (xp < need) break;
    xp -= need;
    level += 1;
    levelsGained += 1;
  }
  if (level >= MAX_SKILL_LEVEL) {
    level = MAX_SKILL_LEVEL;
    xp = 0;
  }
  return { level, xp, levelsGained };
}

/** Sync pet.level to the average skill level for gates / HUD. */
export function syncPetTotalLevelFromSkills(user: IUser): void {
  if (!user.pet) return;
  const total = totalSkillLevel(user.skills);
  user.pet.level = total;
  // Pet XP bar no longer drives identity — keep fields stable for older clients.
  user.pet.xp = 0;
  user.pet.xpToNextLevel = 1;
  user.markModified('pet');
}

export async function getUserSkillLevel(userId: string, skill: SkillId): Promise<number> {
  const user = await User.findById(userId).select(`skills.${skill}`).lean();
  const level = (user as any)?.skills?.[skill]?.level;
  return typeof level === 'number' && level > 0 ? Math.floor(level) : 0;
}

export const skillXpService = {
  /** Read skills (initialises defaults if missing). */
  async getSkills(userId: string): Promise<{ skills: PublicSkills; totalLevel: number } | null> {
    const user = await User.findById(userId);
    if (!user) return null;
    const skills = ensureUserSkills(user);
    const dirty = user.isModified('skills');
    if (dirty || (user.pet && user.pet.level !== totalSkillLevel(skills))) {
      syncPetTotalLevelFromSkills(user);
      user.markModified('skills');
      await user.save();
    }
    return { skills: toPublicSkills(skills), totalLevel: totalSkillLevel(skills) };
  },

  /**
   * Grant XP to one skill. Primary API for game / wellness systems.
   * @example await skillXpService.grant(userId, 'farming', 12)
   * @example await skillXpService.grantReward(userId, 'farm_harvest')
   */
  async grant(
    userId: string,
    skill: SkillId,
    amount: number,
  ): Promise<SkillXpGrantResult | null> {
    if (!isSkillId(skill)) {
      log.warn({ userId, skill }, 'Rejected skill XP grant — invalid skill id');
      return null;
    }

    const safeAmount = Math.min(MAX_SKILL_XP_GRANT, Math.max(0, Math.floor(Number(amount) || 0)));
    if (!safeAmount) {
      const current = await this.getSkills(userId);
      if (!current) return null;
      return { skills: current.skills, totalLevel: current.totalLevel, gained: [] };
    }

    const user = await User.findById(userId);
    if (!user) return null;

    const skills = ensureUserSkills(user);
    const next = applySkillXpTo(skills[skill], safeAmount);
    // Assign a plain object so Mongoose persists nested skill progress.
    skills[skill] = { level: next.level, xp: next.xp };
    user.markModified('skills');
    syncPetTotalLevelFromSkills(user);
    await user.save();

    let unlockedRecipes: string[] | undefined;
    let itemRewards: SkillItemReward[] | undefined;
    let inventory: Record<string, number> | undefined;
    let storage: Record<string, number> | undefined;

    // Crafting milestones: backpack capacity + recipe journal unlocks.
    if (skill === 'crafting' && next.levelsGained > 0) {
      try {
        const { Farm } = await import('../models/Farm.js');
        const { backpackSlotsFromCraftingLevel } = await import('../constants/skillPerks.js');
        const farm = await Farm.findOne({ userId });
        if (farm) {
          const slots = backpackSlotsFromCraftingLevel(next.level);
          if (farm.backpackSlots !== slots) {
            farm.backpackSlots = slots;
            farm.markModified('backpackSlots');
            await farm.save();
          }
        }
      } catch (err: any) {
        log.warn({ userId, err: err.message }, 'Failed to sync backpack slots after crafting XP');
      }

      try {
        const { grantCraftingRecipesForLevelUp } = await import('./CraftingLevelRecipeUnlocks.js');
        const fromLevel = next.level - next.levelsGained;
        unlockedRecipes = await grantCraftingRecipesForLevelUp(userId, fromLevel, next.level);
      } catch (err: any) {
        log.warn({ userId, err: err.message }, 'Failed to grant crafting level recipe unlocks');
      }
    }

    // Cooking milestones: recipe journal unlocks every 2 levels.
    if (skill === 'cooking' && next.levelsGained > 0) {
      try {
        const { grantCookingRecipesForLevelUp } = await import('./CookingLevelRecipeUnlocks.js');
        const fromLevel = next.level - next.levelsGained;
        const cookingUnlocks = await grantCookingRecipesForLevelUp(userId, fromLevel, next.level);
        if (cookingUnlocks.length) {
          unlockedRecipes = [...(unlockedRecipes ?? []), ...cookingUnlocks];
        }
      } catch (err: any) {
        log.warn({ userId, err: err.message }, 'Failed to grant cooking level recipe unlocks');
      }
    }

    // Farming milestones: grant soil (Bramble soil item).
    if (skill === 'farming' && next.levelsGained > 0) {
      try {
        const { syncFarmingSoilThroughLevel } = await import('./FarmingLevelSoilGrants.js');
        const { FARMING_SOIL_ITEM_TYPE } = await import('../constants/farmingLevelSoilGrants.js');
        const soilGrant = await syncFarmingSoilThroughLevel(userId, next.level);
        if (soilGrant?.qty) {
          itemRewards = [{ itemType: FARMING_SOIL_ITEM_TYPE, qty: soilGrant.qty }];
          inventory = soilGrant.inventory;
          storage = soilGrant.storage;
        }
      } catch (err: any) {
        log.warn({ userId, err: err.message }, 'Failed to grant farming soil from skill milestones');
      }
    }

    const publicSkills = toPublicSkills(skills);
    const result: SkillGrantResult = {
      skill,
      amount: safeAmount,
      levelsGained: next.levelsGained,
      level: publicSkills[skill].level,
      xp: publicSkills[skill].xp,
      xpToNextLevel: publicSkills[skill].xpToNextLevel,
    };

    log.info(
      {
        userId,
        skill,
        amount: result.amount,
        levelsGained: result.levelsGained,
        level: result.level,
        totalLevel: totalSkillLevel(skills),
        unlockedRecipes: unlockedRecipes?.length ?? 0,
        itemRewards: itemRewards?.length ?? 0,
      },
      'Skill XP granted',
    );

    return {
      skills: publicSkills,
      totalLevel: totalSkillLevel(skills),
      gained: [result],
      ...(unlockedRecipes?.length ? { unlockedRecipes } : {}),
      ...(itemRewards?.length ? { itemRewards, inventory, storage } : {}),
    };
  },

  /** Grant using a named reward constant from `SKILL_XP_REWARDS`. */
  async grantReward(
    userId: string,
    rewardKey: SkillXpRewardKey,
    skill: SkillId,
    multiplier = 1,
  ): Promise<SkillXpGrantResult | null> {
    const base = SKILL_XP_REWARDS[rewardKey];
    return this.grant(userId, skill, Math.floor(base * multiplier));
  },

  /** Grant several skill XP packets in one save. */
  async grantMany(
    userId: string,
    grants: { skill: SkillId; amount: number }[],
  ): Promise<SkillXpGrantResult | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const skills = ensureUserSkills(user);
    const gained: SkillGrantResult[] = [];

    for (const g of grants) {
      if (!isSkillId(g.skill)) continue;
      const safeAmount = Math.min(MAX_SKILL_XP_GRANT, Math.max(0, Math.floor(Number(g.amount) || 0)));
      if (!safeAmount) continue;
      const next = applySkillXpTo(skills[g.skill], safeAmount);
      skills[g.skill] = { level: next.level, xp: next.xp };
      gained.push({
        skill: g.skill,
        amount: safeAmount,
        levelsGained: next.levelsGained,
        level: next.level,
        xp: next.xp,
        xpToNextLevel: xpToNextSkillLevel(next.level),
      });
    }

    if (gained.length === 0) {
      return {
        skills: toPublicSkills(skills),
        totalLevel: totalSkillLevel(skills),
        gained: [],
      };
    }

    user.markModified('skills');
    syncPetTotalLevelFromSkills(user);
    await user.save();

    return {
      skills: toPublicSkills(skills),
      totalLevel: totalSkillLevel(skills),
      gained,
    };
  },
};
