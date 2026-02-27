import { Recipe, type IRecipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';
import { normalizeIngredients, ingredientsMatch, inventoryToRecord } from '../utils/recipeUtils.js';

const log = createLogger('CraftingService');

const SCRAP_ITEM = 'scrap';
const CRAFT_XP = 5;

export interface CraftInput {
  itemType: string;
  qty: number;
}

export interface CraftResult {
  matched: boolean;
  resultItemType: string;
  resultQty: number;
  isNewDiscovery: boolean;
  recipeId?: string;
  recipeLabel?: string;
  inventory: Record<string, number>;
  farmXp: number;
  gems: number;
}

export interface JournalEntry {
  recipeId: string;
  label: string;
  resultItemType: string;
  resultQty: number;
  ingredients: { itemType: string; qty: number }[];
  difficulty: number;
  discoveredAt?: string;
  timesCrafted?: number;
}

export interface JournalResponse {
  recipes: JournalEntry[];
  discoveredCount: number;
  totalCount: number;
}

export const craftingService = {
  async attemptCraft(
    userId: string,
    ingredients: CraftInput[],
    minigamePassed: boolean,
  ): Promise<CraftResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const normalized = normalizeIngredients(ingredients);

    for (const [itemType, qty] of normalized) {
      const owned = farm.inventory.get(itemType) ?? 0;
      if (owned < qty) throw new Error(`Not enough ${itemType} (need ${qty}, have ${owned})`);
    }

    for (const [itemType, qty] of normalized) {
      farm.inventory.set(itemType, (farm.inventory.get(itemType) ?? 0) - qty);
    }

    let matched = false;
    let recipe: IRecipe | null = null;
    let isNewDiscovery = false;

    if (minigamePassed) {
      const allRecipes = await Recipe.find({ recipeType: 'crafting' }).lean();
      recipe = allRecipes.find((r) => ingredientsMatch(r.ingredients, normalized)) ?? null;
      matched = !!recipe;
    }

    const resultItemType = matched && recipe ? recipe.resultItemType : SCRAP_ITEM;
    const resultQty = matched && recipe ? recipe.resultQty : 1;

    farm.inventory.set(resultItemType, (farm.inventory.get(resultItemType) ?? 0) + resultQty);

    farm.xp += CRAFT_XP;

    if (matched && recipe) {
      const existing = await UserRecipeJournal.findOne({ userId, recipeId: recipe.recipeId });
      if (existing) {
        existing.timesCrafted += 1;
        await existing.save();
      } else {
        isNewDiscovery = true;
        await UserRecipeJournal.create({ userId, recipeId: recipe.recipeId });
      }
    }

    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, matched, resultItemType, isNewDiscovery }, 'Craft attempt');

    return {
      matched,
      resultItemType,
      resultQty,
      isNewDiscovery,
      recipeId: recipe?.recipeId,
      recipeLabel: recipe?.label,
      inventory: inventoryToRecord(farm.inventory),
      farmXp: farm.xp,
      gems: farm.gems,
    };
  },

  async getJournal(userId: string): Promise<JournalResponse> {
    const [allRecipes, discovered] = await Promise.all([
      Recipe.find({ recipeType: 'crafting' }).sort({ sortOrder: 1 }).lean(),
      UserRecipeJournal.find({ userId }).lean(),
    ]);

    const discoveredMap = new Map(discovered.map((d) => [d.recipeId, d]));

    const recipes: JournalEntry[] = allRecipes.map((r) => {
      const entry = discoveredMap.get(r.recipeId);
      return {
        recipeId: r.recipeId,
        label: r.label,
        resultItemType: r.resultItemType,
        resultQty: r.resultQty,
        ingredients: r.ingredients,
        difficulty: r.difficulty,
        discoveredAt: entry?.discoveredAt?.toISOString(),
        timesCrafted: entry?.timesCrafted,
      };
    });

    const discoveredCraftingCount = recipes.filter((r) => r.discoveredAt).length;

    return {
      recipes,
      discoveredCount: discoveredCraftingCount,
      totalCount: allRecipes.length,
    };
  },
};
