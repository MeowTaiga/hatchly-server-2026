/**
 * One-time migration: set recipeType on existing recipes.
 * - Existing recipes without recipeType get recipeType: 'cooking'
 * - Seeds sample crafting recipes
 *
 * Run: npx tsx src/scripts/migrateRecipeType.ts
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Recipe } from '../models/Recipe.js';

const CRAFTING_RECIPES = [
  {
    recipeId: 'wood_plank',
    label: 'Wooden Plank',
    resultItemType: 'wooden_plank',
    resultQty: 1,
    ingredients: [{ itemType: 'wood', qty: 2 }],
    difficulty: 1,
    recipeType: 'crafting' as const,
    sortOrder: 10,
  },
  {
    recipeId: 'stone_fence',
    label: 'Stone Fence',
    resultItemType: 'fence',
    resultQty: 1,
    ingredients: [{ itemType: 'wood', qty: 1 }, { itemType: 'stone', qty: 1 }],
    difficulty: 2,
    recipeType: 'crafting' as const,
    sortOrder: 11,
  },
];

async function migrate() {
  await connectDatabase();

  const result = await Recipe.updateMany(
    { recipeType: { $exists: false } },
    { $set: { recipeType: 'cooking' } },
  );
  console.log(`  Updated ${result.modifiedCount} recipes with recipeType: 'cooking'`);

  for (const r of CRAFTING_RECIPES) {
    const existing = await Recipe.findOne({ recipeId: r.recipeId });
    if (!existing) {
      await Recipe.create(r);
      console.log(`  Created crafting recipe: ${r.recipeId}`);
    }
  }

  console.log('\nMigration complete.');
  await disconnectDatabase();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
