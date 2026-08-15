import { Recipe } from '../models/Recipe.js';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { skillXpService, toSkillXpPayload, type SkillXpStatePayload } from './SkillXpService.js';
import { createLogger } from '../config/logger.js';
import { inventoryToRecord } from '../utils/recipeUtils.js';
import { grantLoot, mapToRecord, combinedQty, takeFromBackpackThenStorage } from './inventoryCapacity.js';
import { SMELTING_RECIPES } from '../constants/miningOres.js';

const log = createLogger('SmeltingService');

const SLAG_ITEM = 'slag';
const SMELT_XP = 8;

export interface SmeltResult {
  matched: boolean;
  resultItemType: string;
  resultQty: number;
  isNewDiscovery: boolean;
  recipeId?: string;
  recipeLabel?: string;
  inventory: Record<string, number>;
  storage?: Record<string, number>;
  farmXp: number;
  gems: number;
  skillXp?: SkillXpStatePayload;
}

export interface JournalEntry {
  recipeId: string;
  label: string;
  resultItemType: string;
  resultQty: number;
  ingredients: { itemType: string; qty: number }[];
  difficulty: number;
  owned: boolean;
  canCraft: boolean;
}

export interface JournalResponse {
  recipes: JournalEntry[];
  discoveredCount: number;
  totalCount: number;
  ownedCount: number;
}

function hasIngredients(
  backpack: Map<string, number> | Record<string, number> | undefined | null,
  storage: Map<string, number> | Record<string, number> | undefined | null,
  ingredients: { itemType: string; qty: number }[],
): boolean {
  return ingredients.every((ing) => combinedQty(backpack, storage, ing.itemType) >= ing.qty);
}

export const smeltingService = {
  async attemptSmelt(userId: string, recipeId: string, minigamePassed: boolean): Promise<SmeltResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const recipe = await Recipe.findOne({ recipeId, recipeType: 'smelting' });
    if (!recipe) throw new Error('Unknown smelting recipe');

    for (const ing of recipe.ingredients) {
      const owned = combinedQty(farm.inventory, farm.storage, ing.itemType);
      if (owned < ing.qty) {
        throw new Error(`Not enough ${ing.itemType} (need ${ing.qty}, have ${owned})`);
      }
    }

    for (const ing of recipe.ingredients) {
      takeFromBackpackThenStorage(farm, ing.itemType, ing.qty);
    }

    const matched = minigamePassed;
    const resultItemType = matched ? recipe.resultItemType : SLAG_ITEM;
    const resultQty = matched ? recipe.resultQty : 1;

    grantLoot(farm, resultItemType, resultQty);
    farm.xp += SMELT_XP;
    farm.markModified('inventory');
    await farm.save();

    const skillGrant = await skillXpService.grant(userId, 'mining', SKILL_XP_REWARDS.smelt_ore);

    log.info({ userId, recipeId, matched, resultItemType }, 'Smelt attempt');

    return {
      matched,
      resultItemType,
      resultQty,
      isNewDiscovery: false,
      recipeId: recipe.recipeId,
      recipeLabel: recipe.label,
      inventory: inventoryToRecord(farm.inventory),
      storage: mapToRecord(farm.storage ?? new Map()),
      farmXp: farm.xp,
      gems: farm.gems,
      skillXp: toSkillXpPayload(skillGrant),
    };
  },

  async getJournal(userId: string): Promise<JournalResponse> {
    const farm = await Farm.findOne({ userId }).select('inventory storage').lean();
    const inventory = farm?.inventory as Map<string, number> | Record<string, number> | undefined;
    const storage = farm?.storage as Map<string, number> | Record<string, number> | undefined;

    const allRecipes = await Recipe.find({ recipeType: 'smelting' }).sort({ sortOrder: 1 }).lean();

    const recipes: JournalEntry[] = allRecipes.map((r) => ({
      recipeId: r.recipeId,
      label: r.label,
      resultItemType: r.resultItemType,
      resultQty: r.resultQty,
      ingredients: r.ingredients,
      difficulty: r.difficulty,
      owned: true,
      canCraft: hasIngredients(inventory, storage, r.ingredients),
    }));

    return {
      recipes,
      discoveredCount: recipes.length,
      totalCount: allRecipes.length,
      ownedCount: recipes.length,
    };
  },
};

export async function ensureSmeltingRecipes(): Promise<void> {
  let sort = 4000;
  for (const spec of SMELTING_RECIPES) {
    await Recipe.findOneAndUpdate(
      { recipeId: spec.recipeId },
      {
        $set: {
          label: spec.label,
          resultItemType: spec.resultItemType,
          resultQty: 1,
          ingredients: spec.ingredients,
          difficulty: spec.difficulty,
          recipeType: 'smelting',
          sortOrder: sort++,
        },
        $unset: { recipeItemType: 1 },
      },
      { upsert: true },
    );
  }

  await GameItemDef.findOneAndUpdate(
    { itemType: SLAG_ITEM },
    {
      $set: {
        label: 'Slag',
        emoji: '🪨',
        color: '#5A5348',
        category: 'material',
        subCategory: 'slag',
        placeable: false,
        sellable: true,
        buyable: false,
      },
      $setOnInsert: { itemType: SLAG_ITEM, harvestYield: [], autoConnect: false, gemPrice: 0, sortOrder: 4100 },
    },
    { upsert: true },
  );
}
