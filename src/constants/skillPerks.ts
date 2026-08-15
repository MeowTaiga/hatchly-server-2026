/**
 * Milestone unlocks for each skill. Levels start at 0; thresholds are inclusive
 * ("at level 2 you unlock …").
 *
 * Gameplay effects that are server-authoritative should use the helpers at the
 * bottom. The perk list itself is also mirrored on the client for the skill
 * detail UI.
 */

import type { SkillId } from './skills.js';
import {
  BASE_MINING_ENERGY_CAP,
  MINING_ENERGY_CAP_BONUS,
  MINING_ENERGY_CAP_MILESTONES,
} from './miningEnergy.js';

/** Keep in sync with inventoryCapacity.BASE_BACKPACK_SLOTS */
const BASE_BACKPACK_SLOTS = 20;

export type SkillPerkEffect =
  | { type: 'backpack_slots'; amount: number }
  | { type: 'fishing_ease'; amount: number }
  | { type: 'cooking_ease'; amount: number }
  | { type: 'crafting_ease'; amount: number }
  | { type: 'farm_water_bonus'; amount: number }
  | { type: 'farm_seed_return'; amount: number }
  | { type: 'mine_gem_bonus'; amount: number }
  | { type: 'mine_energy_cap'; amount: number }
  | { type: 'social_pet_bonus'; amount: number }
  | { type: 'health_cap_bonus'; amount: number }
  | { type: 'flavor' };

export interface SkillPerk {
  level: number;
  title: string;
  description: string;
  effect: SkillPerkEffect;
}

/** Crafting levels that each grant +10 backpack slots. */
export const CRAFTING_BACKPACK_MILESTONES = [5, 10, 20, 50, 75, 99] as const;
export const CRAFTING_BACKPACK_BONUS_PER_MILESTONE = 10;

const MINING_ENERGY_CAP_TITLES = [
  'Second wind',
  'Endurance',
  'Stamina',
  'Deep lungs',
  'Iron lungs',
  'Unyielding',
  'Marathon miner',
  'Relentless',
  'Endless shift',
  'Living vein',
] as const;

export const SKILL_PERKS: Record<SkillId, SkillPerk[]> = {
  crafting: [
    ...CRAFTING_BACKPACK_MILESTONES.map((level) => ({
      level,
      title: 'Bigger backpack',
      description: `+${CRAFTING_BACKPACK_BONUS_PER_MILESTONE} backpack slots`,
      effect: { type: 'backpack_slots' as const, amount: CRAFTING_BACKPACK_BONUS_PER_MILESTONE },
    })),
    { level: 15, title: 'Steady hands', description: 'Crafting minigame is a little easier', effect: { type: 'crafting_ease', amount: 1 } },
    { level: 30, title: 'Workshop flow', description: 'Crafting minigame is easier', effect: { type: 'crafting_ease', amount: 1 } },
    { level: 45, title: 'Master artisan', description: 'Crafting minigame is much easier', effect: { type: 'crafting_ease', amount: 1 } },
  ].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title)) as SkillPerk[],

  fishing: [
    { level: 5, title: 'Steady hands', description: 'Fishing minigame is a little easier', effect: { type: 'fishing_ease', amount: 1 } },
    { level: 15, title: 'Reading the water', description: 'Fishing minigame is easier', effect: { type: 'fishing_ease', amount: 1 } },
    { level: 30, title: 'Patient angler', description: 'Fishing minigame is much easier', effect: { type: 'fishing_ease', amount: 1 } },
    { level: 50, title: 'Old salt', description: 'Fishing minigame difficulty drops further', effect: { type: 'fishing_ease', amount: 1 } },
    { level: 75, title: 'Master caster', description: 'Even rare fish feel fair', effect: { type: 'fishing_ease', amount: 1 } },
  ],

  cooking: [
    { level: 5, title: 'Kitchen sense', description: 'Cooking minigame is a little easier', effect: { type: 'cooking_ease', amount: 1 } },
    { level: 15, title: 'Timing', description: 'Cooking minigame is easier', effect: { type: 'cooking_ease', amount: 1 } },
    { level: 30, title: 'Sous-chef', description: 'Cooking minigame is much easier', effect: { type: 'cooking_ease', amount: 1 } },
    { level: 50, title: 'Head chef', description: 'Cooking minigame difficulty drops further', effect: { type: 'cooking_ease', amount: 1 } },
  ],

  farming: [
    { level: 5, title: 'Green thumb', description: 'Watering feels more rewarding', effect: { type: 'farm_water_bonus', amount: 1 } },
    { level: 9, title: 'Seed saver', description: '5% chance to get a seed back when harvesting', effect: { type: 'farm_seed_return', amount: 5 } },
    { level: 15, title: 'Crop sense', description: 'Extra farming XP from watering', effect: { type: 'farm_water_bonus', amount: 1 } },
    { level: 25, title: 'Careful harvest', description: 'Seed return chance is now 10%', effect: { type: 'farm_seed_return', amount: 5 } },
    { level: 30, title: 'Homestead', description: 'Watering grants even more farming XP', effect: { type: 'farm_water_bonus', amount: 1 } },
    { level: 45, title: 'Seed bank', description: 'Seed return chance is now 15%', effect: { type: 'farm_seed_return', amount: 5 } },
    { level: 50, title: 'Agronomist', description: 'Master watering XP bonus', effect: { type: 'farm_water_bonus', amount: 1 } },
  ],

  mining: [
    { level: 5, title: 'Sharp eye', description: 'Slightly better gem finds while digging', effect: { type: 'mine_gem_bonus', amount: 1 } },
    { level: 20, title: 'Prospector', description: 'Better gem finds while digging', effect: { type: 'mine_gem_bonus', amount: 1 } },
    { level: 40, title: 'Vein reader', description: 'Much better gem finds', effect: { type: 'mine_gem_bonus', amount: 1 } },
    { level: 70, title: 'Deep delver', description: 'Top-tier gem find chance', effect: { type: 'mine_gem_bonus', amount: 1 } },
    ...MINING_ENERGY_CAP_MILESTONES.map((level, i) => ({
      level,
      title: MINING_ENERGY_CAP_TITLES[i] ?? 'Bigger lungs',
      description: `+${MINING_ENERGY_CAP_BONUS} mining energy cap`,
      effect: { type: 'mine_energy_cap' as const, amount: MINING_ENERGY_CAP_BONUS },
    })),
  ].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title)) as SkillPerk[],

  social: [
    { level: 5, title: 'Gentle friend', description: 'You can pet a little more often', effect: { type: 'social_pet_bonus', amount: 1 } },
    { level: 20, title: 'Bonded', description: 'Higher hourly pet allowance', effect: { type: 'social_pet_bonus', amount: 1 } },
    { level: 40, title: 'Best pals', description: 'Even more pets per hour', effect: { type: 'social_pet_bonus', amount: 1 } },
  ],

  health: [
    { level: 5, title: 'Mindful', description: '+1 daily food log XP claim', effect: { type: 'health_cap_bonus', amount: 1 } },
    { level: 20, title: 'Routine', description: '+1 more daily food log XP claim', effect: { type: 'health_cap_bonus', amount: 1 } },
    { level: 40, title: 'Wellness habit', description: '+1 more daily food log XP claim', effect: { type: 'health_cap_bonus', amount: 1 } },
  ],
};

export function perksForSkill(skill: SkillId): SkillPerk[] {
  return SKILL_PERKS[skill] ?? [];
}

export function unlockedPerks(skill: SkillId, level: number): SkillPerk[] {
  return perksForSkill(skill).filter((p) => level >= p.level);
}

export function sumPerkAmount(
  skill: SkillId,
  level: number,
  type: SkillPerkEffect['type'],
): number {
  return unlockedPerks(skill, level)
    .filter((p) => p.effect.type === type)
    .reduce((sum, p) => sum + ('amount' in p.effect ? p.effect.amount : 0), 0);
}

/** Base 20 + 10 per crafting backpack milestone reached. */
export function backpackSlotsFromCraftingLevel(craftingLevel: number): number {
  const milestones = sumPerkAmount('crafting', craftingLevel, 'backpack_slots');
  // sumPerkAmount already sums amounts (10 each)
  return BASE_BACKPACK_SLOTS + milestones;
}

/** Base 20 + 5 per mining energy-cap milestone reached (max 70). */
export function miningEnergyCapFromLevel(miningLevel: number): number {
  return BASE_MINING_ENERGY_CAP + sumPerkAmount('mining', miningLevel, 'mine_energy_cap');
}

/** How many difficulty steps to subtract from fishing minigames (0–5). */
export function fishingDifficultyRelief(fishingLevel: number): number {
  return sumPerkAmount('fishing', fishingLevel, 'fishing_ease');
}

export function cookingDifficultyRelief(cookingLevel: number): number {
  return sumPerkAmount('cooking', cookingLevel, 'cooking_ease');
}

export function craftingDifficultyRelief(craftingLevel: number): number {
  return sumPerkAmount('crafting', craftingLevel, 'crafting_ease');
}

/** Percent chance (0–15) to recover the planted seed on harvest. */
export function harvestSeedReturnChance(farmingLevel: number): number {
  return sumPerkAmount('farming', farmingLevel, 'farm_seed_return');
}

export function adjustMinigameDifficulty(base: number, relief: number): number {
  return Math.max(1, Math.min(5, Math.floor(base) - Math.max(0, relief)));
}
