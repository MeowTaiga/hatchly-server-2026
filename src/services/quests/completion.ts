import type { IFarm } from '../../models/Farm.js';
import type { IDialogStep, IQuestDef, IQuestReward } from '../../models/QuestDef.js';
import { Recipe } from '../../models/Recipe.js';
import { UserRecipeJournal } from '../../models/UserRecipeJournal.js';
import { createLogger } from '../../config/logger.js';
import { STARTER_NPC_DEPARTURE_QUEST_ID, STARTER_NPC_ITEM_TYPE } from './constants.js';

const log = createLogger('QuestCompletion');

/** What the app needs to celebrate a finished quest. */
export interface QuestCompletion {
  questId: string;
  title: string;
  type: string;
  /** Only the rewards actually granted, so the app can render exactly what was earned. */
  rewards?: IQuestReward;
  endDialog?: IDialogStep[];
  endDialogSpeaker?: 'pet' | 'npc';
  /** Set when this was an upgrade quest, so the app can play a level-up moment. */
  newFarmLevel?: number;
  /** Placed items removed as part of finishing this quest (e.g. an NPC leaving). */
  removedItemIds?: string[];
}

/**
 * Applies a completion's economy effects to an in-memory farm. The caller owns
 * saving — completing several quests in one event must not write the farm once
 * per quest, which is how the old code lost updates.
 *
 * Recipe unlocks are applied separately via {@link grantQuestRecipes}.
 */
export function applyCompletionToFarm(farm: IFarm, def: IQuestDef): QuestCompletion {
  for (const { itemType, qty } of def.requirements?.items ?? []) {
    const held = farm.inventory.get(itemType) ?? 0;
    const left = held - qty;
    if (left > 0) farm.inventory.set(itemType, left);
    else farm.inventory.delete(itemType);
    farm.markModified('inventory');
  }

  const granted: IQuestReward = {};

  for (const { itemType, qty } of def.rewards?.items ?? []) {
    farm.inventory.set(itemType, (farm.inventory.get(itemType) ?? 0) + qty);
    farm.markModified('inventory');
    granted.items = [...(granted.items ?? []), { itemType, qty }];
  }

  if (def.rewards?.gems) {
    farm.gems += def.rewards.gems;
    granted.gems = def.rewards.gems;
  }

  if (def.rewards?.xp) {
    farm.xp += def.rewards.xp;
    granted.xp = def.rewards.xp;
  }

  if (def.rewards?.recipes?.length) {
    granted.recipes = [...def.rewards.recipes];
  }

  let newFarmLevel: number | undefined;
  if (def.type === 'farm_upgrade' && def.farmLevel && def.farmLevel > farm.farmLevel) {
    farm.farmLevel = def.farmLevel;
    newFarmLevel = def.farmLevel;
  }

  let removedItemIds: string[] | undefined;
  if (def.questId === STARTER_NPC_DEPARTURE_QUEST_ID) {
    const gone = farm.placedItems.filter((i) => i.itemType === STARTER_NPC_ITEM_TYPE).map((i) => i.id);
    if (gone.length > 0) {
      const goneSet = new Set(gone);
      farm.placedItems = farm.placedItems.filter((i) => !goneSet.has(i.id));
      farm.markModified('placedItems');
      removedItemIds = gone;
    }
  }

  return {
    questId: def.questId,
    title: def.title,
    type: def.type,
    rewards:
      granted.items?.length || granted.gems || granted.xp || granted.recipes?.length
        ? granted
        : undefined,
    endDialog: def.endDialog?.length ? def.endDialog : undefined,
    endDialogSpeaker: def.endDialogSpeaker,
    newFarmLevel,
    removedItemIds,
  };
}

/**
 * Upserts crafting recipe knowledge for recipes listed on a quest reward.
 * Idempotent — safe if the player already knows the recipe.
 */
export async function grantQuestRecipes(
  userId: string,
  recipeIds: string[] | undefined,
): Promise<string[]> {
  if (!recipeIds?.length) return [];

  const granted: string[] = [];
  for (const recipeId of recipeIds) {
    const existing = await UserRecipeJournal.findOne({ userId, recipeId }).lean();
    if (existing) continue;

    const recipe = await Recipe.findOne({ recipeId }).lean();
    if (!recipe) {
      log.warn({ userId, recipeId }, 'Quest recipe reward missing — run seed:crafting / seed:cooking');
      continue;
    }

    await UserRecipeJournal.create({
      userId,
      recipeId,
      timesCrafted: 0,
      discoveredAt: new Date(),
    });
    granted.push(recipeId);
  }

  if (granted.length > 0) {
    log.info({ userId, granted }, 'Granted quest crafting recipes');
  }
  return granted;
}

/**
 * Upgrade quests are finished by the player pressing Upgrade Farm, so the level
 * change is always a deliberate act with a celebration attached. Everything
 * else completes the moment its checklist is satisfied.
 */
export function completesAutomatically(def: Pick<IQuestDef, 'type'>): boolean {
  return def.type !== 'farm_upgrade';
}
