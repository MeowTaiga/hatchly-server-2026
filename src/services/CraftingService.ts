import { Recipe, type IRecipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { Farm } from '../models/Farm.js';
import { createLogger } from '../config/logger.js';
import { inventoryToRecord } from '../utils/recipeUtils.js';
import {
  ensureCraftingRecipeItemDef,
  resolveRecipeItemType,
} from './CraftingRecipeItems.js';
import { ensureStarterCraftingRecipes } from './StarterCraftingRecipes.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { backpackSlotsFromCraftingLevel } from '../constants/skillPerks.js';
import { skillXpService, toSkillXpPayload, type SkillXpStatePayload } from './SkillXpService.js';
import { grantLoot, mapToRecord, combinedQty, takeFromBackpackThenStorage } from './inventoryCapacity.js';

const log = createLogger('CraftingService');

const SCRAP_ITEM = 'scrap';
const CRAFT_XP = 5;

export interface CraftResult {
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
  backpackSlots?: number;
  skillXp?: SkillXpStatePayload;
}

export interface LearnRecipeResult {
  recipeId: string;
  recipeLabel: string;
  recipeItemType: string;
  alreadyKnown: boolean;
  inventory: Record<string, number>;
  storage?: Record<string, number>;
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
  recipeItemType?: string;
  /** True when the player has learned this recipe (journal entry). */
  owned: boolean;
  /** Unconsumed recipe scroll currently in inventory. */
  hasScroll: boolean;
  /** True when learned and inventory covers every ingredient. */
  canCraft: boolean;
  discoveredAt?: string;
  timesCrafted?: number;
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

async function findCraftingRecipeByScrollItem(itemType: string): Promise<IRecipe | null> {
  const byField = await Recipe.findOne({ recipeType: 'crafting', recipeItemType: itemType });
  if (byField) return byField;

  if (!itemType.startsWith('recipe_')) return null;
  const recipeId = itemType.slice('recipe_'.length);
  return Recipe.findOne({ recipeType: 'crafting', recipeId });
}

export const craftingService = {
  /**
   * Consume a recipe scroll from inventory to permanently learn the craft.
   * Scroll is removed; knowledge is stored on UserRecipeJournal.
   */
  async learnFromScroll(userId: string, itemType: string): Promise<LearnRecipeResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const recipe = await findCraftingRecipeByScrollItem(itemType);
    if (!recipe) throw new Error('That item is not a crafting recipe');

    const recipeItemType = resolveRecipeItemType(recipe);
    if (!recipe.recipeItemType) {
      recipe.recipeItemType = recipeItemType;
      await recipe.save();
      await ensureCraftingRecipeItemDef(recipe);
    }

    if (combinedQty(farm.inventory, farm.storage, recipeItemType) < 1) {
      throw new Error('You do not have this recipe scroll');
    }

    const existing = await UserRecipeJournal.findOne({ userId, recipeId: recipe.recipeId });
    if (existing) {
      throw new Error('You already know this recipe');
    }

    takeFromBackpackThenStorage(farm, recipeItemType, 1);

    await UserRecipeJournal.create({
      userId,
      recipeId: recipe.recipeId,
      timesCrafted: 0,
      discoveredAt: new Date(),
    });

    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, recipeId: recipe.recipeId, recipeItemType }, 'Recipe learned from scroll');

    return {
      recipeId: recipe.recipeId,
      recipeLabel: recipe.label,
      recipeItemType,
      alreadyKnown: false,
      inventory: inventoryToRecord(farm.inventory),
      storage: mapToRecord(farm.storage ?? new Map()),
      farmXp: farm.xp,
      gems: farm.gems,
    };
  },

  /**
   * Craft a learned recipe by id. Requires journal entry + materials.
   * Failed minigame still spends materials → scrap.
   */
  async attemptCraft(
    userId: string,
    recipeId: string,
    minigamePassed: boolean,
  ): Promise<CraftResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const recipe = await Recipe.findOne({ recipeId, recipeType: 'crafting' });
    if (!recipe) throw new Error('Unknown crafting recipe');

    const recipeItemType = resolveRecipeItemType(recipe);
    if (!recipe.recipeItemType) {
      recipe.recipeItemType = recipeItemType;
      await recipe.save();
      await ensureCraftingRecipeItemDef(recipe);
    }

    const learned = await UserRecipeJournal.findOne({ userId, recipeId: recipe.recipeId });
    if (!learned) {
      throw new Error('Learn this recipe from a scroll before crafting it');
    }

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
    const resultItemType = matched ? recipe.resultItemType : SCRAP_ITEM;
    const resultQty = matched ? recipe.resultQty : 1;

    grantLoot(farm, resultItemType, resultQty);
    farm.xp += CRAFT_XP;

    if (matched) {
      learned.timesCrafted += 1;
      await learned.save();
    }

    farm.markModified('inventory');
    await farm.save();

    const skillGrant = await skillXpService.grant(userId, 'crafting', SKILL_XP_REWARDS.craft);
    const craftingLevel = skillGrant?.skills?.crafting?.level ?? 0;
    const backpackSlots = backpackSlotsFromCraftingLevel(craftingLevel);

    log.info({ userId, recipeId, matched, resultItemType }, 'Craft attempt');

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
      backpackSlots,
      skillXp: toSkillXpPayload(skillGrant),
    };
  },

  async getJournal(userId: string): Promise<JournalResponse> {
    const farm = await Farm.findOne({ userId }).select('inventory storage').lean();
    const inventory = farm?.inventory as Map<string, number> | Record<string, number> | undefined;
    const storage = farm?.storage as Map<string, number> | Record<string, number> | undefined;

    const [allRecipes, discovered] = await Promise.all([
      Recipe.find({ recipeType: 'crafting' }).sort({ sortOrder: 1 }).lean(),
      UserRecipeJournal.find({ userId }).lean(),
    ]);

    const discoveredMap = new Map(discovered.map((d) => [d.recipeId, d]));

    const recipes: JournalEntry[] = allRecipes.map((r) => {
      const entry = discoveredMap.get(r.recipeId);
      const recipeItemType = resolveRecipeItemType(r as IRecipe);
      const learned = !!entry;
      const hasScroll = combinedQty(inventory, storage, recipeItemType) >= 1;
      const canCraft = learned && hasIngredients(inventory, storage, r.ingredients);
      return {
        recipeId: r.recipeId,
        label: r.label,
        resultItemType: r.resultItemType,
        resultQty: r.resultQty,
        ingredients: r.ingredients,
        difficulty: r.difficulty,
        recipeItemType,
        owned: learned,
        hasScroll,
        canCraft,
        discoveredAt: entry?.discoveredAt?.toISOString(),
        timesCrafted: entry?.timesCrafted,
      };
    });

    const ownedCount = recipes.filter((r) => r.owned).length;

    return {
      recipes,
      discoveredCount: ownedCount,
      totalCount: allRecipes.length,
      ownedCount,
    };
  },

  /**
   * Grant default crafting knowledge (stick tools) without consuming scrolls.
   * Idempotent — safe on every farm load/create.
   */
  ensureStarterRecipes: ensureStarterCraftingRecipes,
};
