/**
 * Merge themed furniture / clutter recipe scrolls (items.txt + items2.txt)
 * into balloon and fossil (dig hole) loot pools.
 *
 * Skips processed materials (plank / iron / rope / glass) and primitive
 * crafting.txt recipes. Harder crafts map to higher rarity.
 *
 *   npm run seed:loot-recipes
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { STARTER_CRAFTING_RECIPE_IDS } from '../constants/starterCraftingRecipes.js';
import { BalloonLootConfig, type IBalloonLootEntry } from '../models/BalloonLootConfig.js';
import { FossilLootConfig, type IFossilLootEntry } from '../models/FossilLootConfig.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { Recipe } from '../models/Recipe.js';
import { defaultRecipeItemType } from '../services/CraftingRecipeItems.js';
import { DIFFICULTY_TO_LOOT_RARITY, RARITY_WEIGHTS } from '../utils/rarity.js';
import type { BugRarity } from '../models/GameItemDef.js';

const log = createLogger('LootRecipes');

const SKIP_GROUPS = new Set(['materials']);

type LootEntry = { itemType: string; rarity: BugRarity; weight: number };

function clampDifficulty(n: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.round(n);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as 2 | 3 | 4;
}

function mergeEntries(existing: LootEntry[], incoming: LootEntry[]): LootEntry[] {
  const byType = new Map<string, LootEntry>();
  for (const e of existing) byType.set(e.itemType, e);
  for (const e of incoming) byType.set(e.itemType, e);
  return [...byType.values()];
}

function normalizeExisting(
  entries: Array<{ itemType: string; rarity: BugRarity; weight?: number }> | undefined,
): LootEntry[] {
  return (entries ?? []).map((e) => ({
    itemType: e.itemType,
    rarity: e.rarity,
    weight: e.weight ?? RARITY_WEIGHTS[e.rarity],
  }));
}

async function main(): Promise<void> {
  await connectDatabase();

  const recipes = await Recipe.find({
    recipeType: 'crafting',
    group: { $exists: true, $nin: ['', ...SKIP_GROUPS] },
    recipeId: { $nin: [...STARTER_CRAFTING_RECIPE_IDS] },
  })
    .select('recipeId label difficulty recipeItemType group')
    .lean();

  const scrollTypes = recipes.map((r) => r.recipeItemType?.trim() || defaultRecipeItemType(r.recipeId));
  const existingScrolls = await GameItemDef.find({ itemType: { $in: scrollTypes } })
    .select('itemType')
    .lean();
  const validScrolls = new Set(existingScrolls.map((d) => d.itemType));

  const incoming: LootEntry[] = [];
  const skipped: string[] = [];
  const byRarity: Record<BugRarity, number> = {
    common: 0,
    rare: 0,
    epic: 0,
    unique: 0,
    legendary: 0,
    mythic: 0,
  };

  for (const recipe of recipes) {
    const itemType = recipe.recipeItemType?.trim() || defaultRecipeItemType(recipe.recipeId);
    if (!validScrolls.has(itemType)) {
      skipped.push(itemType);
      continue;
    }
    const rarity = DIFFICULTY_TO_LOOT_RARITY[clampDifficulty(recipe.difficulty)];
    incoming.push({
      itemType,
      rarity,
      weight: RARITY_WEIGHTS[rarity],
    });
    byRarity[rarity] += 1;
  }

  const balloonDoc = await BalloonLootConfig.findOne();
  const fossilDoc = await FossilLootConfig.findOne();

  const balloonMerged = mergeEntries(normalizeExisting(balloonDoc?.entries), incoming);
  const fossilMerged = mergeEntries(normalizeExisting(fossilDoc?.entries), incoming);

  await BalloonLootConfig.findOneAndUpdate(
    {},
    { $set: { entries: balloonMerged as IBalloonLootEntry[] } },
    { upsert: true, new: true, runValidators: true },
  );
  await FossilLootConfig.findOneAndUpdate(
    {},
    { $set: { entries: fossilMerged as IFossilLootEntry[] } },
    { upsert: true, new: true, runValidators: true },
  );

  log.info(
    {
      recipesConsidered: recipes.length,
      scrollsAdded: incoming.length,
      skippedMissingItem: skipped.length,
      byRarity,
      balloonTotal: balloonMerged.length,
      fossilTotal: fossilMerged.length,
    },
    'Craft recipe scrolls merged into balloon + fossil loot',
  );

  await disconnectDatabase();
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
