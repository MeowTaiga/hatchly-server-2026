/**
 * Skill IDs and display metadata for the OSRS-style progression system.
 * Companion / pet level = floor of the average of every skill's level (each starts at 0).
 */

export const SKILL_IDS = [
  'farming',
  'fishing',
  'cooking',
  'crafting',
  'mining',
  'social',
  'health',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export const MAX_SKILL_LEVEL = 99;

/** Hard cap on a single skill XP grant (anti-abuse / bad content defs). */
export const MAX_SKILL_XP_GRANT = 250;

/** Max social XP from feeding a pet (clamps GameItemDef.foodPetXp). */
export const MAX_FEED_PET_SKILL_XP = 40;

/**
 * Power-curve XP to advance from `level` → `level + 1`.
 * Tuned for a gentle early game and a long mid/late grind:
 *   L0→1 = 40, L1→2 ≈ 40, L10→11 ≈ 560, L50→51 ≈ 18k, L98→99 ≈ 80k
 */
export const SKILL_XP_BASE = 40;
export const SKILL_XP_POWER = 2.15;

export const SKILL_META: Record<
  SkillId,
  { label: string; emoji: string; description: string }
> = {
  farming: {
    label: 'Farming',
    emoji: '🌾',
    description: 'Planting, watering, and harvesting crops.',
  },
  fishing: {
    label: 'Fishing',
    emoji: '🎣',
    description: 'Catching fish in town and on the farm.',
  },
  cooking: {
    label: 'Cooking',
    emoji: '🍳',
    description: 'Cooking meals at the pot.',
  },
  crafting: {
    label: 'Crafting',
    emoji: '🪵',
    description: 'Crafting tools and furniture.',
  },
  mining: {
    label: 'Mining',
    emoji: '⛏️',
    description: 'Digging fossils and mining ore.',
  },
  social: {
    label: 'Social',
    emoji: '💬',
    description: 'Petting, chatting, and caring for friendships.',
  },
  health: {
    label: 'Health',
    emoji: '💚',
    description: 'Logging food, water, mood, and wellness.',
  },
};

/** Default XP amounts for common game actions (easy to tweak in one place). */
export const SKILL_XP_REWARDS = {
  // Farming
  farm_place: 3,
  farm_harvest: 12,
  farm_water: 4,
  farm_remove: 1,
  farm_tree_shake: 8,
  farm_tree_chop: 4,
  bug_catch: 10,
  // Fishing
  fish_catch: 15,
  // Cooking / crafting
  cook: 10,
  craft: 10,
  // Mining / dig
  dig_fossil: 12,
  mine_ore: 14,
  smelt_ore: 10,
  // Social
  pet_pet: 8,
  achievement: 20,
  feed_pet: 6,
  pet_chat: 4,
  spirit_snatch: 16,
  // Health (wellness logs — still respect daily caps via PetService)
  health_food: 15,
  health_water: 8,
  health_weight: 12,
  health_mood: 12,
} as const;

export type SkillXpRewardKey = keyof typeof SKILL_XP_REWARDS;

export function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value);
}

/** XP needed to go from `level` to `level + 1` (levels start at 0). */
export function xpToNextSkillLevel(level: number): number {
  if (level >= MAX_SKILL_LEVEL) return Number.MAX_SAFE_INTEGER;
  const safe = Math.max(0, Math.floor(level));
  // 0→1 uses the flat base so brand-new skills aren't stuck at 0 XP needed.
  if (safe === 0) return SKILL_XP_BASE;
  return Math.max(1, Math.floor(SKILL_XP_BASE * Math.pow(safe, SKILL_XP_POWER)));
}
