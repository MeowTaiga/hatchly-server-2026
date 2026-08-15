import { Recipe, type IRecipe } from '../models/Recipe.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { petService } from './PetService.js';
import { User } from '../models/User.js';
import { MAX_FEED_PET_SKILL_XP, SKILL_XP_REWARDS } from '../constants/skills.js';
import { skillXpService, toSkillXpPayload, type SkillXpStatePayload } from './SkillXpService.js';
import { createLogger } from '../config/logger.js';
import { inventoryToRecord } from '../utils/recipeUtils.js';
import {
  ensureCookingRecipeItemDef,
  resolveRecipeItemType,
} from './CookingRecipeItems.js';
import { grantLoot, mapToRecord, combinedQty, takeFromBackpackThenStorage } from './inventoryCapacity.js';

const log = createLogger('CookingService');

const STRANGE_STEW_ITEM = 'strange_stew';
const COOK_XP = 5;

export interface CookResult {
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
  group?: string;
  owned: boolean;
  hasScroll: boolean;
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

async function findCookingRecipeByScrollItem(itemType: string): Promise<IRecipe | null> {
  const byField = await Recipe.findOne({ recipeType: 'cooking', recipeItemType: itemType });
  if (byField) return byField;

  if (!itemType.startsWith('recipe_')) return null;
  const recipeId = itemType.slice('recipe_'.length);
  return Recipe.findOne({ recipeType: 'cooking', recipeId });
}

export const cookingService = {
  /**
   * Consume a cooking recipe scroll to permanently learn the dish.
   */
  async learnFromScroll(userId: string, itemType: string): Promise<LearnRecipeResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const recipe = await findCookingRecipeByScrollItem(itemType);
    if (!recipe) throw new Error('That item is not a cooking recipe');

    const recipeItemType = resolveRecipeItemType(recipe);
    if (!recipe.recipeItemType) {
      recipe.recipeItemType = recipeItemType;
      await recipe.save();
      await ensureCookingRecipeItemDef(recipe);
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

    log.info({ userId, recipeId: recipe.recipeId, recipeItemType }, 'Cooking recipe learned from scroll');

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
   * Cook a learned recipe by id. Requires journal entry + materials.
   * Failed minigame still spends materials → strange stew.
   */
  async attemptCook(
    userId: string,
    recipeId: string,
    minigamePassed: boolean,
  ): Promise<CookResult> {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');

    const recipe = await Recipe.findOne({ recipeId, recipeType: 'cooking' });
    if (!recipe) throw new Error('Unknown cooking recipe');

    const recipeItemType = resolveRecipeItemType(recipe);
    if (!recipe.recipeItemType) {
      recipe.recipeItemType = recipeItemType;
      await recipe.save();
      await ensureCookingRecipeItemDef(recipe);
    }

    const learned = await UserRecipeJournal.findOne({ userId, recipeId: recipe.recipeId });
    if (!learned) {
      throw new Error('Learn this recipe from a scroll before cooking it');
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
    const resultItemType = matched ? recipe.resultItemType : STRANGE_STEW_ITEM;
    const resultQty = matched ? recipe.resultQty : 1;

    grantLoot(farm, resultItemType, resultQty);
    farm.xp += COOK_XP;

    if (matched) {
      learned.timesCrafted += 1;
      await learned.save();
    }

    farm.markModified('inventory');
    await farm.save();

    const skillGrant = await skillXpService.grant(userId, 'cooking', SKILL_XP_REWARDS.cook);

    log.info({ userId, recipeId, matched, resultItemType }, 'Cook attempt');

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

    const [allRecipes, discovered] = await Promise.all([
      Recipe.find({ recipeType: 'cooking' }).sort({ sortOrder: 1 }).lean(),
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
        group: (r as IRecipe & { group?: string }).group,
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

  async feedPet(
    userId: string,
    foodItemType: string,
  ): Promise<{
    hungerGain: number;
    happyGain: number;
    xpGain: number;
    pet: Record<string, unknown>;
    skillXp?: SkillXpStatePayload;
  }> {
    const def = await GameItemDef.findOne({ itemType: foodItemType }).lean();
    if (!def || def.category !== 'food') throw new Error(`${foodItemType} is not food`);

    const hungerGain = def.foodHunger ?? 10;
    const happyGain = def.foodHappiness ?? 5;
    const xpGain = Math.min(
      MAX_FEED_PET_SKILL_XP,
      Math.max(0, Math.floor(def.foodPetXp ?? SKILL_XP_REWARDS.feed_pet)),
    );

    const user = await User.findById(userId);
    if (!user?.pet) throw new Error('No pet found');

    user.pet.hunger = Math.min(100, (user.pet.hunger ?? 0) + hungerGain);
    user.pet.happy = Math.min(100, (user.pet.happy ?? 0) + happyGain);
    user.markModified('pet');
    await user.save();

    let skillXp: SkillXpStatePayload | undefined;
    if (xpGain > 0) {
      const bonus = await petService.grantBonusXP(userId, xpGain, `fed_${foodItemType}`, 'social');
      if (bonus.skills && bonus.xpGained > 0 && bonus.totalLevel != null) {
        skillXp = {
          skill: 'social',
          amount: bonus.xpGained,
          levelsGained: 0,
          level: bonus.skills.social.level,
          totalLevel: bonus.totalLevel,
          skills: bonus.skills,
        };
      }
    }

    log.info({ userId, foodItemType, hungerGain, happyGain, xpGain }, 'Pet fed');
    const refreshed = await User.findById(userId).select('pet').lean();
    const pet = JSON.parse(JSON.stringify(refreshed?.pet ?? user.pet));
    return { hungerGain, happyGain, xpGain, pet, skillXp };
  },

  /** True when itemType is a cooking recipe scroll (for learn routing). */
  async isCookingScroll(itemType: string): Promise<boolean> {
    const recipe = await findCookingRecipeByScrollItem(itemType);
    return !!recipe;
  },
};
