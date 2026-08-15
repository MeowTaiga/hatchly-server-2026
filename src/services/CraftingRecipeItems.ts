import { GameItemDef } from '../models/GameItemDef.js';
import type { IRecipe } from '../models/Recipe.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('CraftingRecipeItems');

export const CRAFTING_RECIPE_TEMPLATE = 'crafting_recipe';

/** Shared scroll art for every crafting recipe inventory item. */
export const CRAFTING_RECIPE_IMAGE_URL =
  'https://images.hatchly.me/game-items/crafting_recipe/d78ed89b-f84e-4b67-afd4-eec08dbe42ab.png';

/** Inventory itemType that unlocks a crafting recipe (e.g. recipe_wood_plank). */
export function defaultRecipeItemType(recipeId: string): string {
  return `recipe_${recipeId}`;
}

/**
 * Ensure a GameItemDef exists for a crafting recipe scroll.
 * Always uses the shared crafting_recipe scroll art.
 */
export async function ensureCraftingRecipeItemDef(recipe: {
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
    subCategory: 'crafting_recipe',
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

  log.info({ itemType, recipeId: recipe.recipeId }, 'Crafting recipe item ensured');
  return itemType;
}

/** Point every existing recipe-scroll item at the shared scroll art. */
export async function syncAllCraftingRecipeItemImages(): Promise<number> {
  const result = await GameItemDef.updateMany(
    {
      $or: [
        { subCategory: 'crafting_recipe' },
        { itemType: { $regex: /^recipe_/ } },
        { itemType: CRAFTING_RECIPE_TEMPLATE },
      ],
    },
    { $set: { imageUrl: CRAFTING_RECIPE_IMAGE_URL } },
  );

  log.info({ matched: result.matchedCount, modified: result.modifiedCount }, 'Synced recipe scroll images');
  return result.modifiedCount;
}

/** Resolve the inventory unlock item for a recipe document. */
export function resolveRecipeItemType(recipe: Pick<IRecipe, 'recipeId' | 'recipeItemType'>): string {
  return recipe.recipeItemType?.trim() || defaultRecipeItemType(recipe.recipeId);
}
