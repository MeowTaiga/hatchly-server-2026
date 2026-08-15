/**
 * Farming skill milestones that grant soil (same itemType as Bramble quests).
 *
 * ~15 grants from level 0 → 99. Levels intentionally avoid farming perk
 * milestones (5 / 15 / 30 / 50) so each level feels distinct.
 *
 * Edit qty or move levels freely. Keep the client mirror in sync:
 *   hatchly-app-2026/constants/farmingLevelSoilGrants.ts
 */

export const FARMING_SOIL_ITEM_TYPE = 'soil';

/** Levels that grant soil (about every 6–7 levels, offset from perk rewards). */
export const FARMING_SOIL_GRANT_LEVELS = [
  6, 12, 18, 24, 32, 38, 44, 52, 58, 64, 70, 76, 82, 88, 94,
] as const;

export type FarmingSoilGrantLevel = (typeof FARMING_SOIL_GRANT_LEVELS)[number];

/** Qty of soil granted at each milestone. Easy to bump later. */
export const FARMING_LEVEL_SOIL_QTY: Record<FarmingSoilGrantLevel, number> = {
  6: 1,
  12: 1,
  18: 1,
  24: 1,
  32: 1,
  38: 1,
  44: 2,
  52: 2,
  58: 2,
  64: 2,
  70: 2,
  76: 2,
  82: 2,
  88: 2,
  94: 2,
};

export interface FarmingSoilGrantTier {
  level: number;
  qty: number;
}

export function farmingSoilGrantTiers(): FarmingSoilGrantTier[] {
  return FARMING_SOIL_GRANT_LEVELS.map((level) => ({
    level,
    qty: FARMING_LEVEL_SOIL_QTY[level],
  })).filter((t) => t.qty > 0);
}

/**
 * Total soil qty unlocked when moving from `fromLevel` (exclusive) → `toLevel` (inclusive).
 */
export function soilQtyUnlockedBetween(fromLevel: number, toLevel: number): number {
  const from = Math.max(0, Math.floor(fromLevel));
  const to = Math.max(0, Math.floor(toLevel));
  if (to <= from) return 0;

  let qty = 0;
  for (const level of FARMING_SOIL_GRANT_LEVELS) {
    if (level <= from || level > to) continue;
    qty += FARMING_LEVEL_SOIL_QTY[level] ?? 0;
  }
  return qty;
}

/** Milestone levels crossed in (fromLevel, toLevel]. */
export function soilGrantLevelsBetween(fromLevel: number, toLevel: number): number[] {
  const from = Math.max(0, Math.floor(fromLevel));
  const to = Math.max(0, Math.floor(toLevel));
  if (to <= from) return [];
  return FARMING_SOIL_GRANT_LEVELS.filter((level) => level > from && level <= to);
}
