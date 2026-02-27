import { Recipe, type IRecipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { petService } from './PetService.js';
import { User } from '../models/User.js';
import { createLogger } from '../config/logger.js';
import { normalizeIngredients, ingredientsMatch, findBatchFactor, ingredientsMatchBatch, inventoryToRecord } from '../utils/recipeUtils.js';

const log = createLogger('CookingService');

const STRANGE_STEW_ITEM = 'strange_stew';
const COOK_XP = 5;

export interface CookInput {
  itemType: string;
  qty: number;
}

export interface CookResult {
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

export const cookingService = {
  /**
   * Attempts to cook with the given ingredients.
   * Supports batch crafting: when bowl ingredients are a multiple of a recipe,
   * consumes and produces proportionally (e.g. 2× recipe → 2× result).
   */
  async attemptCook(
    userId: string,
    ingredients: CookInput[],
    minigamePassed: boolean,
  ): Promise<CookResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const normalized = normalizeIngredients(ingredients);

    let matched = false;
    let recipe: IRecipe | null = null;
    let batchFactor = 1;

    if (minigamePassed) {
      const allRecipes = await Recipe.find({ recipeType: 'cooking' }).lean();
      let bestFactor = 0;
      for (const r of allRecipes) {
        const factor = findBatchFactor(r.ingredients, normalized);
        if (factor >= 1 && ingredientsMatchBatch(r.ingredients, normalized, factor)) {
          if (factor > bestFactor) {
            bestFactor = factor;
            recipe = r;
            batchFactor = factor;
          }
        }
      }
      matched = !!recipe;
    }

    if (!matched) {
      batchFactor = 1;
    }

    // Validate and consume ingredients
    const consumeMap = new Map<string, number>();
    if (matched && recipe) {
      for (const ri of recipe.ingredients) {
        const needed = ri.qty * batchFactor;
        consumeMap.set(ri.itemType, (consumeMap.get(ri.itemType) ?? 0) + needed);
      }
    } else {
      for (const [itemType, qty] of normalized) {
        consumeMap.set(itemType, qty);
      }
    }

    for (const [itemType, qty] of consumeMap) {
      const owned = farm.inventory.get(itemType) ?? 0;
      if (owned < qty) throw new Error(`Not enough ${itemType} (need ${qty}, have ${owned})`);
    }

    for (const [itemType, qty] of consumeMap) {
      farm.inventory.set(itemType, (farm.inventory.get(itemType) ?? 0) - qty);
    }

    let isNewDiscovery = false;
    const resultItemType = matched && recipe ? recipe.resultItemType : STRANGE_STEW_ITEM;
    const resultQty = (matched && recipe ? recipe.resultQty : 1) * batchFactor;

    farm.inventory.set(resultItemType, (farm.inventory.get(resultItemType) ?? 0) + resultQty);

    farm.xp += COOK_XP;

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

    log.info({ userId, matched, resultItemType, isNewDiscovery }, 'Cook attempt');

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
      Recipe.find({ recipeType: 'cooking' }).sort({ sortOrder: 1 }).lean(),
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

    const discoveredCookingCount = recipes.filter((r) => r.discoveredAt).length;

    return {
      recipes,
      discoveredCount: discoveredCookingCount,
      totalCount: allRecipes.length,
    };
  },

  async feedPet(
    userId: string,
    foodItemType: string,
  ): Promise<{ hungerGain: number; happyGain: number; xpGain: number; pet: Record<string, unknown> }> {
    const def = await GameItemDef.findOne({ itemType: foodItemType }).lean();
    if (!def || def.category !== 'food') throw new Error(`${foodItemType} is not food`);

    const hungerGain = def.foodHunger ?? 10;
    const happyGain = def.foodHappiness ?? 5;
    const xpGain = def.foodPetXp ?? 10;

    const user = await User.findById(userId);
    if (!user?.pet) throw new Error('No pet found');

    user.pet.hunger = Math.min(100, (user.pet.hunger ?? 0) + hungerGain);
    user.pet.happy = Math.min(100, (user.pet.happy ?? 0) + happyGain);
    user.markModified('pet');
    await user.save();

    if (xpGain > 0) {
      await petService.grantBonusXP(userId, xpGain, `fed_${foodItemType}`);
    }

    log.info({ userId, foodItemType, hungerGain, happyGain, xpGain }, 'Pet fed');
    const pet = JSON.parse(JSON.stringify(user.pet));
    return { hungerGain, happyGain, xpGain, pet };
  },
};
