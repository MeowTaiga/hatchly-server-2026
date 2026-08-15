/**
 * Grants cooking journal knowledge from cooking skill milestones.
 * Idempotent — safe on every farm load and after multi-level jumps.
 */

import { Recipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import {
  cookingRecipeIdsUnlockedBetween,
  cookingRecipeIdsUnlockedThroughLevel,
} from '../constants/cookingLevelRecipeUnlocks.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('CookingLevelRecipeUnlocks');

async function grantRecipeIds(userId: string, recipeIds: string[]): Promise<string[]> {
  if (!recipeIds.length) return [];

  const granted: string[] = [];
  for (const recipeId of recipeIds) {
    const existing = await UserRecipeJournal.findOne({ userId, recipeId }).lean();
    if (existing) continue;

    const recipe = await Recipe.findOne({ recipeId, recipeType: 'cooking' }).lean();
    if (!recipe) {
      log.warn({ userId, recipeId }, 'Level-unlock cooking recipe missing — run seed:cooking');
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
    log.info({ userId, granted, count: granted.length }, 'Granted cooking level recipe unlocks');
  }
  return granted;
}

/** Catch-up: grant every cooking recipe the player should know at `cookingLevel`. */
export async function syncCookingRecipesThroughLevel(
  userId: string,
  cookingLevel: number,
): Promise<string[]> {
  return grantRecipeIds(userId, cookingRecipeIdsUnlockedThroughLevel(cookingLevel));
}

/**
 * Grant recipes for levels crossed when going from `fromLevel` → `toLevel`.
 */
export async function grantCookingRecipesForLevelUp(
  userId: string,
  fromLevel: number,
  toLevel: number,
): Promise<string[]> {
  return grantRecipeIds(userId, cookingRecipeIdsUnlockedBetween(fromLevel, toLevel));
}
