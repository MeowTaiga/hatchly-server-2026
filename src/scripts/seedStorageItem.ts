/**
 * Seed the placeable Storage chest + sticks crafting recipe.
 * Run: npx tsx src/scripts/seedStorageItem.ts
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { Recipe } from '../models/Recipe.js';
import { ensureCraftingRecipeItemDef } from '../services/CraftingRecipeItems.js';

const log = createLogger('SeedStorage');

const ITEM_TYPE = 'storage';
const RECIPE_ID = 'storage';
const RECIPE_ITEM_TYPE = 'recipe_storage';
const STICK_COST = 15;

async function main() {
  await connectDatabase();

  await GameItemDef.findOneAndUpdate(
    { itemType: 'stick' },
    {
      $setOnInsert: {
        itemType: 'stick',
        label: 'Stick',
        emoji: '🪵',
        color: '#A1887F',
        category: 'material',
        placeable: false,
        cols: 1,
        rows: 1,
        harvestYield: [],
        autoConnect: false,
        buyable: false,
        gemPrice: 0,
        sellable: true,
        sellPrice: 1,
      },
    },
    { upsert: true },
  );

  await GameItemDef.findOneAndUpdate(
    { itemType: ITEM_TYPE },
    {
      $set: {
        label: 'Storage',
        emoji: '📦',
        color: '#8D6E63',
        category: 'building',
        subCategory: 'storage',
        placeable: true,
        cols: 2,
        rows: 2,
        sellable: true,
        sellPrice: 5,
        buyable: false,
        gemPrice: 0,
        interactAction: { type: 'open_modal', payload: 'storage' },
        centerOverflow: true,
      },
      $setOnInsert: {
        itemType: ITEM_TYPE,
        harvestYield: [],
        autoConnect: false,
      },
    },
    { upsert: true },
  );

  await Recipe.findOneAndUpdate(
    { recipeId: RECIPE_ID },
    {
      $set: {
        label: 'Storage',
        resultItemType: ITEM_TYPE,
        resultQty: 1,
        ingredients: [{ itemType: 'stick', qty: STICK_COST }],
        difficulty: 1,
        recipeType: 'crafting',
        recipeItemType: RECIPE_ITEM_TYPE,
        sortOrder: 50,
      },
      $setOnInsert: { recipeId: RECIPE_ID },
    },
    { upsert: true },
  );

  await ensureCraftingRecipeItemDef({
    recipeId: RECIPE_ID,
    label: 'Storage',
    recipeItemType: RECIPE_ITEM_TYPE,
  });

  // Make the recipe scroll buyable so players can unlock without luck.
  await GameItemDef.findOneAndUpdate(
    { itemType: RECIPE_ITEM_TYPE },
    { $set: { buyable: true, gemPrice: 5, sellable: true, sellPrice: 1 } },
  );

  log.info({ itemType: ITEM_TYPE, sticks: STICK_COST }, 'Storage item + recipe seeded');
  await disconnectDatabase();
}

main().catch(async (err) => {
  log.error({ err }, 'Seed failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
