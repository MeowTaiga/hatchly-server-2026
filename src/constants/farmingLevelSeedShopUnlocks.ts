/**
 * Farming skill milestones that unlock seeds in the shop (buy access only —
 * no inventory grant). Rare/event seeds are intentionally omitted for the
 * rotating seed shop and limited-time events.
 *
 * Keep the client mirror in sync:
 *   hatchly-app-2026/constants/farmingLevelSeedShopUnlocks.ts
 */

/** Levels that unlock shop seeds (~every 2 levels). */
export const FARMING_SEED_SHOP_UNLOCK_LEVELS = [
  2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42,
  44, 46, 48, 50, 52, 54, 56, 58,
] as const;

export type FarmingSeedShopUnlockLevel = (typeof FARMING_SEED_SHOP_UNLOCK_LEVELS)[number];

/**
 * Level → seed itemTypes unlocked for shop purchase at that farming skill level.
 * Wheat is buyable from the start (no skill gate) — see FARMING_STARTER_SHOP_SEEDS.
 */
export const FARMING_LEVEL_SEED_SHOP_UNLOCKS: Record<
  FarmingSeedShopUnlockLevel,
  readonly string[]
> = {
  // Tier 1 — starters
  2: ['grass_seed', 'clover_seed'],
  4: ['carrot_seed', 'radish_seed'],
  6: ['lettuce_seed', 'spinach_seed'],
  8: ['green_onion_seed', 'potato_seed'],
  10: ['turnip_seed'],

  // Tier 2 — common veggies
  12: ['tomato_seeds', 'corn_seed'],
  14: ['cucumber_seed', 'pumpkin_seed'],
  16: ['bell_pepper_seed', 'chili_pepper_seed'],
  18: ['eggplant_seed', 'cabbage_seed'],
  20: ['broccoli_seed', 'cauliflower_seed'],
  22: ['onion_seed', 'garlic_seed'],
  24: ['celery_seed', 'pea_seed'],
  26: ['bean_seed', 'sugar_cane_seed'],

  // Tier 3 — berries & melons
  28: ['strawberry_seed', 'blueberry_seed'],
  30: ['raspberry_seed', 'blackberry_seed'],
  32: ['watermelon_seeds', 'melon_seed'],

  // Tier 4 — herbs
  34: ['basil_seed', 'mint_seed'],
  36: ['rosemary_seed', 'thyme_seed'],
  38: ['oregano_seed', 'sage_seed'],
  40: ['parsley_seed', 'dill_seed'],
  42: ['chive_seed', 'lavender_seed'],
  44: ['chamomile_seed', 'cilantro_seed'],
  46: ['tarragon_seed', 'bay_seed'],
  48: ['fennel_seed'],

  // Tier 5 — common flowers (premium flowers / mushrooms / exotics stay reserved)
  50: ['sunflower_seed', 'daisy_seed'],
  52: ['rose_seed', 'tulip_bulb'],
  54: ['marigold_seed', 'cosmos_seed'],
  56: ['poppy_seed', 'lily_bulb'],
  58: ['hibiscus_seed', 'iris_bulb'],
};

/** Always in the main shop; no farming skill gate. */
export const FARMING_STARTER_SHOP_SEEDS = ['wheat_seed'] as const;

/**
 * Seeds kept off the skill progression for events / rotating seed shop.
 * (Not applied by the unlock script — left buyable:false unless an event flips them.)
 */
export const FARMING_RESERVED_EVENT_SEEDS = [
  // Specialty flowers
  'orchid_seed',
  'lotus_seed',
  'lavender_flower_seed',
  'peony_bulb',
  'hydrangea_seed',
  // Mushrooms
  'brown_mushroom_spores',
  'red_mushroom_spores',
  'shiitake_spores',
  'oyster_mushroom_spores',
  'morel_spores',
  'glow_mushroom_spores',
  'moss_mushroom_spores',
  'fairy_mushroom_spores',
  'truffle_spores',
  'mooncap_spores',
  // Exotic
  'crystal_berry_seed',
  'moon_blossom_seed',
  'sunfruit_seed',
  'starfruit_seed',
  'dragonfruit_seed',
  'spirit_melon_seed',
  'aurora_berry_seed',
  'honey_blossom_seed',
  'rainbow_flower_seed',
  'frost_berry_seed',
  'ember_pepper_seed',
  'dream_fruit_seed',
  'celestial_herb_seed',
  // Oddballs / event stock
  'okra_seed',
] as const;

/** Default gem prices applied when unlocking (only if current price is 0). */
export const FARMING_SEED_SHOP_DEFAULT_PRICES: Record<string, number> = {
  wheat_seed: 1,
  grass_seed: 2,
  clover_seed: 2,
  carrot_seed: 4,
  radish_seed: 4,
  lettuce_seed: 4,
  spinach_seed: 5,
  green_onion_seed: 5,
  potato_seed: 6,
  turnip_seed: 6,
  tomato_seeds: 8,
  corn_seed: 8,
  cucumber_seed: 9,
  pumpkin_seed: 10,
  bell_pepper_seed: 10,
  chili_pepper_seed: 10,
  eggplant_seed: 11,
  cabbage_seed: 11,
  broccoli_seed: 12,
  cauliflower_seed: 12,
  onion_seed: 12,
  garlic_seed: 12,
  celery_seed: 13,
  pea_seed: 13,
  bean_seed: 14,
  sugar_cane_seed: 15,
  strawberry_seed: 14,
  blueberry_seed: 15,
  raspberry_seed: 16,
  blackberry_seed: 16,
  watermelon_seeds: 18,
  melon_seed: 20,
  basil_seed: 14,
  mint_seed: 14,
  rosemary_seed: 15,
  thyme_seed: 15,
  oregano_seed: 15,
  sage_seed: 16,
  parsley_seed: 16,
  dill_seed: 16,
  chive_seed: 16,
  lavender_seed: 18,
  chamomile_seed: 18,
  cilantro_seed: 18,
  tarragon_seed: 18,
  bay_seed: 20,
  fennel_seed: 20,
  sunflower_seed: 18,
  daisy_seed: 18,
  rose_seed: 22,
  tulip_bulb: 22,
  marigold_seed: 20,
  cosmos_seed: 20,
  poppy_seed: 22,
  lily_bulb: 24,
  hibiscus_seed: 24,
  iris_bulb: 24,
};

export interface FarmingSeedShopUnlockTier {
  level: number;
  seedItemTypes: readonly string[];
}

export function farmingSeedShopUnlockTiers(): FarmingSeedShopUnlockTier[] {
  return FARMING_SEED_SHOP_UNLOCK_LEVELS.filter(
    (level) => (FARMING_LEVEL_SEED_SHOP_UNLOCKS[level]?.length ?? 0) > 0,
  ).map((level) => ({
    level,
    seedItemTypes: FARMING_LEVEL_SEED_SHOP_UNLOCKS[level],
  }));
}

/** Seeds unlocked exactly at `level` (empty if none). */
export function seedItemTypesUnlockedAtLevel(level: number): readonly string[] {
  if (!Number.isFinite(level)) return [];
  const key = Math.floor(level) as FarmingSeedShopUnlockLevel;
  return FARMING_LEVEL_SEED_SHOP_UNLOCKS[key] ?? [];
}

/**
 * Seed itemTypes unlocked when moving from `fromLevel` (exclusive) → `toLevel` (inclusive).
 */
export function seedItemTypesUnlockedBetween(
  fromLevel: number,
  toLevel: number,
): string[] {
  const from = Math.max(0, Math.floor(fromLevel));
  const to = Math.max(0, Math.floor(toLevel));
  if (to <= from) return [];

  const out: string[] = [];
  for (let level = from + 1; level <= to; level++) {
    out.push(...seedItemTypesUnlockedAtLevel(level));
  }
  return out;
}

/** Flat list of every progression shop seed (including starter wheat). */
export function allFarmingShopProgressionSeeds(): string[] {
  const set = new Set<string>(FARMING_STARTER_SHOP_SEEDS);
  for (const level of FARMING_SEED_SHOP_UNLOCK_LEVELS) {
    for (const id of FARMING_LEVEL_SEED_SHOP_UNLOCKS[level] ?? []) set.add(id);
  }
  return [...set];
}

export function farmingSkillLevelForShopSeed(itemType: string): number | undefined {
  if ((FARMING_STARTER_SHOP_SEEDS as readonly string[]).includes(itemType)) {
    return undefined;
  }
  for (const level of FARMING_SEED_SHOP_UNLOCK_LEVELS) {
    if ((FARMING_LEVEL_SEED_SHOP_UNLOCKS[level] ?? []).includes(itemType)) {
      return level;
    }
  }
  return undefined;
}

/** Seeds sell for half the shop buy price so they cannot be flipped for profit. */
export function seedSellPriceFromBuy(gemPrice: number): number {
  return Math.max(1, Math.floor(gemPrice / 2));
}

/**
 * Net gems after rebuying the seed. Wheat (< 1 min) stays +2. Longer crops
 * pay more lump sum so wait time is worth it, but gems/minute still fall
 * off vs babysitting wheat or catching trout.
 *
 * ~2.2 * minutes^0.55 → 2m +3, 5m +5, 10m +8, 20m +11, 1h +21, 6h +58
 */
export function growthNetGems(growthMs: number): number {
  const minutes = Math.max(0, growthMs) / 60_000;
  if (minutes < 1) return 2;
  return Math.max(3, Math.round(2.2 * Math.pow(minutes, 0.55)));
}

/** Produce sell = seed buy + time-scaled net. */
export function produceSellPriceFromSeedBuy(gemPrice: number, growthMs: number): number {
  if (gemPrice <= 0) return 0;
  return gemPrice + growthNetGems(growthMs);
}
