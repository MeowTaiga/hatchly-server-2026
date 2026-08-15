/**
 * Crop growth times for every shop seed. Wheat is the only sub-1-minute
 * crop. Each unlock band is a clearly longer wait than the one before it:
 *
 *   wheat     30s
 *   T1        3m → 2h 30m   (session)
 *   T2        4h → 10h 40m  (leave and come back)
 *   T3        14h → 20h     (overnight)
 *   T4        24h → 38h     (next day)
 *   T5        42h → 52h     (two days)
 *
 * Event / reserved seeds keep their existing long times (clamped to ≥ 2m).
 * Produce sell scales with growthMs in farmingLevelSeedShopUnlocks.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const WHEAT_SEED_ITEM_TYPE = 'wheat_seed';
export const WHEAT_GROWTH_MS = 30_000;

/** Floor for every non-wheat seed. */
export const MIN_NON_WHEAT_GROWTH_MS = 2 * MINUTE;

function min(n: number): number {
  return n * MINUTE;
}

function hr(hours: number, extraMin = 0): number {
  return hours * HOUR + extraMin * MINUTE;
}

export const CROP_GROWTH_MS: Record<string, number> = {
  wheat_seed: WHEAT_GROWTH_MS,

  // T1 — session crops
  grass_seed: min(3),
  clover_seed: min(8),
  carrot_seed: min(15),
  radish_seed: min(25),
  lettuce_seed: min(40),
  spinach_seed: min(55),
  green_onion_seed: min(75),
  potato_seed: min(105),
  turnip_seed: min(150),

  // T2 — leave and come back
  tomato_seeds: hr(4),
  corn_seed: hr(4, 30),
  cucumber_seed: hr(5),
  pumpkin_seed: hr(5, 30),
  bell_pepper_seed: hr(6),
  chili_pepper_seed: hr(6, 20),
  eggplant_seed: hr(7),
  cabbage_seed: hr(7, 20),
  broccoli_seed: hr(8),
  cauliflower_seed: hr(8, 20),
  onion_seed: hr(8, 50),
  garlic_seed: hr(9, 10),
  celery_seed: hr(9, 40),
  pea_seed: hr(10),
  bean_seed: hr(10, 20),
  sugar_cane_seed: hr(10, 40),

  // T3 — overnight
  strawberry_seed: hr(14),
  blueberry_seed: hr(15),
  raspberry_seed: hr(16, 30),
  blackberry_seed: hr(17, 30),
  watermelon_seeds: hr(19),
  melon_seed: hr(20),

  // T4 — next day
  basil_seed: hr(24),
  mint_seed: hr(25),
  rosemary_seed: hr(26),
  thyme_seed: hr(27),
  oregano_seed: hr(28),
  sage_seed: hr(29),
  parsley_seed: hr(30),
  dill_seed: hr(31),
  chive_seed: hr(32),
  lavender_seed: hr(33),
  chamomile_seed: hr(34),
  cilantro_seed: hr(35),
  tarragon_seed: hr(36),
  bay_seed: hr(37),
  fennel_seed: hr(38),

  // T5 — two days
  sunflower_seed: hr(42),
  daisy_seed: hr(43),
  rose_seed: hr(44),
  tulip_bulb: hr(45),
  marigold_seed: hr(46),
  cosmos_seed: hr(47),
  poppy_seed: hr(48),
  lily_bulb: hr(49),
  hibiscus_seed: hr(50),
  iris_bulb: hr(52),

  // Event leftover that was 30s–5m
  okra_seed: min(40),
};

export function resolveCropGrowthMs(itemType: string, currentMs?: number | null): number {
  if (itemType === WHEAT_SEED_ITEM_TYPE) return WHEAT_GROWTH_MS;
  if (CROP_GROWTH_MS[itemType] != null) return CROP_GROWTH_MS[itemType];
  const n = typeof currentMs === 'number' && currentMs > 0 ? currentMs : MIN_NON_WHEAT_GROWTH_MS;
  return Math.max(n, MIN_NON_WHEAT_GROWTH_MS);
}
