/**
 * Ensure every crafting GameRecipe has a recipe scroll item (shared crafting_recipe art)
 * and recipeItemType linked on the recipe doc.
 *
 * Run: npm run seed:crafting-recipes
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { Recipe } from '../models/Recipe.js';
import {
  defaultRecipeItemType,
  ensureCraftingRecipeItemDef,
  syncAllCraftingRecipeItemImages,
} from '../services/CraftingRecipeItems.js';

const log = createLogger('SeedCraftingRecipes');

async function main(): Promise<void> {
  await connectDatabase();

  const recipes = await Recipe.find({ recipeType: 'crafting' });
  log.info({ count: recipes.length }, 'Crafting recipes found');

  for (const recipe of recipes) {
    const recipeItemType = recipe.recipeItemType || defaultRecipeItemType(recipe.recipeId);
    await ensureCraftingRecipeItemDef({
      recipeId: recipe.recipeId,
      label: recipe.label,
      recipeItemType,
    });
    if (recipe.recipeItemType !== recipeItemType) {
      recipe.recipeItemType = recipeItemType;
      await recipe.save();
    }
    log.info({ recipeId: recipe.recipeId, recipeItemType }, 'Linked recipe item');
  }

  const synced = await syncAllCraftingRecipeItemImages();
  log.info({ synced }, 'Recipe scroll images synced to shared art');

  await disconnectDatabase();
  log.info('Done');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
