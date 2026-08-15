import { GameItemDef } from '../models/GameItemDef.js';
import type { IRecipe } from '../models/Recipe.js';
import { createLogger } from '../config/logger.js';
import {
  CRAFTING_RECIPE_IMAGE_URL,
  CRAFTING_RECIPE_TEMPLATE,
  defaultRecipeItemType,
  resolveRecipeItemType,
} from './CraftingRecipeItems.js';

const log = createLogger('CookingRecipeItems');

export const COOKING_RECIPE_SUBCATEGORY = 'cooking_recipe';

/**
 * Ensure a GameItemDef exists for a cooking recipe scroll.
 * Reuses shared scroll art from crafting_recipe template when available.
 */
export async function ensureCookingRecipeItemDef(recipe: {
  recipeId: string;
  label: string;
  recipeItemType?: string | null;
}): Promise<string> {
  const itemType = recipe.recipeItemType?.trim() || defaultRecipeItemType(recipe.recipeId);
  const template = await GameItemDef.findOne({ itemType: CRAFTING_RECIPE_TEMPLATE }).lean();
  const imageUrl = template?.imageUrl?.trim() || CRAFTING_RECIPE_IMAGE_URL;

  const $set: Record<string, unknown> = {
    label: `${recipe.label} Recipe`,
    emoji: template?.emoji || '📜',
    color: template?.color || '#C4A574',
    category: 'material',
    subCategory: COOKING_RECIPE_SUBCATEGORY,
    placeable: false,
    cols: 1,
    rows: 1,
    sellable: false,
    buyable: true,
    imageUrl,
  };

  await GameItemDef.findOneAndUpdate(
    { itemType },
    {
      $set,
      $setOnInsert: {
        itemType,
        harvestYield: [],
        autoConnect: false,
        gemPrice: 0,
      },
    },
    { upsert: true },
  );

  log.info({ itemType, recipeId: recipe.recipeId }, 'Cooking recipe item ensured');
  return itemType;
}

export { defaultRecipeItemType, resolveRecipeItemType };
