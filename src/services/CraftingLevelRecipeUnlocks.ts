/**
 * Grants crafting journal knowledge from crafting skill milestones.
 * Idempotent — safe on every farm load and after multi-level jumps.
 */

import { Recipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import {
  recipeIdsUnlockedBetween,
  recipeIdsUnlockedThroughLevel,
} from '../constants/craftingLevelRecipeUnlocks.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('CraftingLevelRecipeUnlocks');

async function grantRecipeIds(userId: string, recipeIds: string[]): Promise<string[]> {
  if (!recipeIds.length) return [];

  const granted: string[] = [];
  for (const recipeId of recipeIds) {
    const existing = await UserRecipeJournal.findOne({ userId, recipeId }).lean();
    if (existing) continue;

    const recipe = await Recipe.findOne({ recipeId, recipeType: 'crafting' }).lean();
    if (!recipe) {
      log.warn({ userId, recipeId }, 'Level-unlock crafting recipe missing — run seed:crafting');
      continue;
    }

    await UserRecipeJournal.create({
      userId,
      recipeId,
      timesCrafted: 0,
      discoveredAt: new Date(),
    });
    granted.push(recipeId);
  }

  if (granted.length > 0) {
    log.info({ userId, granted, count: granted.length }, 'Granted crafting level recipe unlocks');
  }
  return granted;
}

/** Catch-up: grant every recipe the player should know at `craftingLevel`. */
export async function syncCraftingRecipesThroughLevel(
  userId: string,
  craftingLevel: number,
): Promise<string[]> {
  return grantRecipeIds(userId, recipeIdsUnlockedThroughLevel(craftingLevel));
}

/**
 * Grant recipes for levels crossed when going from `fromLevel` → `toLevel`.
 * Prefer this on XP level-up so we only process newly crossed milestones.
 */
export async function grantCraftingRecipesForLevelUp(
  userId: string,
  fromLevel: number,
  toLevel: number,
): Promise<string[]> {
  return grantRecipeIds(userId, recipeIdsUnlockedBetween(fromLevel, toLevel));
}
