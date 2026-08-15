/**
 * Pick a random goal treat: an unlearned cooking/crafting recipe scroll,
 * or a cute items3 deco piece.
 */

import { GameItemDef } from '../models/GameItemDef.js';
import { Recipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { STARTER_CRAFTING_RECIPE_IDS } from '../constants/starterCraftingRecipes.js';
import { GOAL_CUTE_DECO_ITEM_TYPES, GOAL_REWARD_BUCKET_WEIGHTS } from '../constants/goalRewards.js';
import { GOAL_DEFAULT_REWARD_ITEM } from '../constants/goalCatalog.js';
import { defaultRecipeItemType } from '../services/CraftingRecipeItems.js';
import { DIFFICULTY_TO_LOOT_RARITY, RARITY_WEIGHTS, weightedPick } from '../utils/rarity.js';
import { combinedQty } from './inventoryCapacity.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('GoalRewardService');

export interface GoalRewardItem {
  itemType: string;
  label: string;
  imageUrl?: string;
  emoji?: string;
  qty: number;
}

type FarmMaps = {
  inventory: Map<string, number>;
  storage?: Map<string, number> | null;
};

interface PoolEntry {
  itemType: string;
  weight: number;
}

function difficultyWeight(difficulty: number | undefined): number {
  const clamped = Math.max(1, Math.min(5, Math.round(difficulty ?? 1))) as 1 | 2 | 3 | 4 | 5;
  return RARITY_WEIGHTS[DIFFICULTY_TO_LOOT_RARITY[clamped]];
}

function alreadyHolds(farm: FarmMaps, itemType: string): boolean {
  return combinedQty(farm.inventory, farm.storage, itemType) > 0;
}

async function recipeScrollPool(
  recipeType: 'cooking' | 'crafting',
  knownIds: Set<string>,
  farm: FarmMaps,
  validItemTypes: Set<string>,
): Promise<PoolEntry[]> {
  const filter: Record<string, unknown> = { recipeType };
  if (recipeType === 'crafting') {
    filter.recipeId = { $nin: [...STARTER_CRAFTING_RECIPE_IDS] };
    filter.group = { $nin: ['materials'] };
  }
  const recipes = await Recipe.find(filter)
    .select('recipeId recipeItemType difficulty')
    .lean();

  const pool: PoolEntry[] = [];
  for (const recipe of recipes) {
    if (knownIds.has(recipe.recipeId)) continue;
    const itemType = recipe.recipeItemType?.trim() || defaultRecipeItemType(recipe.recipeId);
    if (!validItemTypes.has(itemType)) continue;
    if (alreadyHolds(farm, itemType)) continue;
    pool.push({ itemType, weight: difficultyWeight(recipe.difficulty) });
  }
  return pool;
}

async function decoPool(farm: FarmMaps, validItemTypes: Set<string>): Promise<PoolEntry[]> {
  const unused = GOAL_CUTE_DECO_ITEM_TYPES.filter(
    (itemType) => validItemTypes.has(itemType) && !alreadyHolds(farm, itemType),
  );
  const source = unused.length ? unused : GOAL_CUTE_DECO_ITEM_TYPES.filter((t) => validItemTypes.has(t));
  return source.map((itemType) => ({ itemType, weight: 1 }));
}

async function defFor(itemType: string): Promise<GoalRewardItem> {
  const def = await GameItemDef.findOne({ itemType }).lean();
  return {
    itemType,
    label: def?.label ?? itemType,
    imageUrl: def?.imageUrl,
    emoji: def?.emoji,
    qty: 1,
  };
}

/**
 * Choose one inventory item for a rewarded goal complete.
 * Prefers unlearned recipe scrolls; falls back to cute deco, then wheat seed.
 */
export async function pickGoalRewardItem(userId: string, farm: FarmMaps): Promise<GoalRewardItem> {
  const [known, scrollDefs, decoDefs] = await Promise.all([
    UserRecipeJournal.find({ userId }).select('recipeId').lean(),
    GameItemDef.find({ subCategory: { $in: ['crafting_recipe', 'cooking_recipe'] } })
      .select('itemType')
      .lean(),
    GameItemDef.find({ itemType: { $in: [...GOAL_CUTE_DECO_ITEM_TYPES] } })
      .select('itemType')
      .lean(),
  ]);
  const knownIds = new Set(known.map((j) => j.recipeId));
  const validItemTypes = new Set([
    ...scrollDefs.map((d) => d.itemType),
    ...decoDefs.map((d) => d.itemType),
  ]);

  const [cooking, crafting, deco] = await Promise.all([
    recipeScrollPool('cooking', knownIds, farm, validItemTypes),
    recipeScrollPool('crafting', knownIds, farm, validItemTypes),
    decoPool(farm, validItemTypes),
  ]);

  const buckets: { kind: keyof typeof GOAL_REWARD_BUCKET_WEIGHTS; items: PoolEntry[]; weight: number }[] = [];
  if (cooking.length) buckets.push({ kind: 'cooking', items: cooking, weight: GOAL_REWARD_BUCKET_WEIGHTS.cooking });
  if (crafting.length) buckets.push({ kind: 'crafting', items: crafting, weight: GOAL_REWARD_BUCKET_WEIGHTS.crafting });
  if (deco.length) buckets.push({ kind: 'deco', items: deco, weight: GOAL_REWARD_BUCKET_WEIGHTS.deco });

  if (!buckets.length) {
    log.warn({ userId }, 'Goal reward pool empty — falling back to default item');
    return defFor(GOAL_DEFAULT_REWARD_ITEM);
  }

  const bucket = weightedPick(buckets, (b) => b.weight);
  const picked = weightedPick(bucket.items, (e) => e.weight);
  log.info({ userId, kind: bucket.kind, itemType: picked.itemType }, 'Picked goal reward');
  return defFor(picked.itemType);
}
