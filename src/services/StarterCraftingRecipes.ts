import { Recipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { STARTER_CRAFTING_RECIPE_IDS } from '../constants/starterCraftingRecipes.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('StarterCraftingRecipes');

/**
 * Grant default crafting knowledge (stick tools) without consuming scrolls.
 * Idempotent — safe on every farm load/create.
 */
export async function ensureStarterCraftingRecipes(userId: string): Promise<number> {
  let granted = 0;
  for (const recipeId of STARTER_CRAFTING_RECIPE_IDS) {
    const existing = await UserRecipeJournal.findOne({ userId, recipeId }).lean();
    if (existing) continue;
    const recipe = await Recipe.findOne({ recipeId, recipeType: 'crafting' }).lean();
    if (!recipe) {
      log.warn({ userId, recipeId }, 'Starter crafting recipe missing — run seed:crafting');
      continue;
    }
    await UserRecipeJournal.create({
      userId,
      recipeId,
      timesCrafted: 0,
    });
    granted += 1;
  }
  if (granted > 0) {
    log.info({ userId, granted }, 'Granted starter crafting recipes');
  }
  return granted;
}
