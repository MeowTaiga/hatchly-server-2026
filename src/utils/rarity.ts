/**
 * Shared rarity weights and utilities for bugs, balloons, and other loot systems.
 */
import type { BugRarity } from '../models/GameItemDef.js';

/** Spawn/loot weight per rarity — lower = rarer. */
export const RARITY_WEIGHTS: Record<BugRarity, number> = {
  common: 100,
  rare: 40,
  epic: 15,
  unique: 5,
  legendary: 2,
  mythic: 0.5,
};

/** Fishing mini-game difficulty (1-5) from rarity — used for rounds and speed. */
export const RARITY_TO_DIFFICULTY: Record<BugRarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  unique: 4,
  legendary: 5,
  mythic: 5,
};

/** Craft difficulty (1-5) → loot rarity. Harder crafts drop less often. */
export const DIFFICULTY_TO_LOOT_RARITY: Record<1 | 2 | 3 | 4 | 5, BugRarity> = {
  1: 'common',
  2: 'rare',
  3: 'epic',
  4: 'unique',
  5: 'legendary',
};

/** Gem multiplier applied on catch/reward per rarity. */
export const RARITY_GEM_MULTIPLIER: Record<BugRarity, number> = {
  common: 1,
  rare: 1.5,
  epic: 2.5,
  unique: 4,
  legendary: 7,
  mythic: 15,
};

/**
 * Pick an item from an array using weighted random selection.
 * @param items - Array of items to pick from
 * @param getWeight - Function returning weight for each item (higher = more likely)
 */
export function weightedPick<T>(items: T[], getWeight: (item: T) => number): T {
  if (items.length === 0) throw new Error('weightedPick: empty array');
  let totalWeight = 0;
  const weights = items.map((item) => {
    const w = getWeight(item);
    totalWeight += w;
    return w;
  });
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}
