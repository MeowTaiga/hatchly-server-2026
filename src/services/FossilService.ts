import { Farm } from '../models/Farm.js';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { FossilLootConfig, type IFossilLootEntry } from '../models/FossilLootConfig.js';
import { UserCollection } from '../models/UserCollection.js';
import { farmService, withQuestSync } from './FarmService.js';
import { questService } from './quests/index.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { attachSkillXp, skillXpService } from './SkillXpService.js';
import { createLogger } from '../config/logger.js';
import { RARITY_WEIGHTS, weightedPick } from '../utils/rarity.js';
import type { StateUpdate } from './FarmService.js';

const log = createLogger('FossilService');

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}

function isShovel(itemType: string | undefined, itemDefs: Record<string, IGameItemDef>): boolean {
  if (!itemType) return false;
  const sub = itemDefs[itemType]?.subCategory;
  return sub === 'shovel' || sub === 'shovels';
}

export interface FossilDigResult {
  anchorId: string;
  itemType: string;
  label: string;
  qty: number;
}

export async function digFossil(userId: string, anchorId: string): Promise<{
  result: FossilDigResult;
  stateUpdate: StateUpdate;
} | null> {
  const farm = await farmService.loadOrCreateFarm(userId);
  const itemDefsMap = await GameItemDef.find().lean();
  const itemDefs = Object.fromEntries(itemDefsMap.map((d) => [d.itemType, d]));

  const target = farm.placedItems.find((i) => i.id === anchorId || i.anchorId === anchorId);
  if (!target) {
    log.warn({ userId, anchorId }, 'Fossil not found');
    return null;
  }

  const def = itemDefs[target.itemType];
  const isDiggable =
    target.itemType === 'fossil_hole' ||
    (def?.subCategory === 'dig_hole');
  if (!isDiggable) {
    log.warn({ userId, anchorId, itemType: target.itemType }, 'Item is not diggable');
    return null;
  }

  const handTool = farm.equipped?.handTool;
  if (!handTool || !isShovel(handTool, itemDefs)) {
    log.warn({ userId, handTool }, 'Shovel not equipped');
    return null;
  }

  const config = await FossilLootConfig.findOne().lean();
  const entries = config?.entries ?? [];
  const validItemTypes = new Set(itemDefsMap.map((d) => d.itemType));
  const eligible = entries.filter((e) => validItemTypes.has(e.itemType));

  if (eligible.length === 0) {
    log.warn({ userId }, 'Fossil loot pool empty');
    return null;
  }

  const picked = weightedPick(eligible, (e) => (e as IFossilLootEntry).weight ?? RARITY_WEIGHTS[(e as IFossilLootEntry).rarity]);
  const pickedDef = itemDefs[picked.itemType];
  const label = pickedDef?.label ?? picked.itemType;
  const qty = 1;

  const anchId = target.anchorId ?? target.id;
  const toRemove = farm.placedItems.filter((i) => i.id === anchId || i.anchorId === anchId);
  const removeIds = new Set(toRemove.map((i) => i.id));
  farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

  const current = farm.inventory.get(picked.itemType) ?? 0;
  farm.inventory.set(picked.itemType, current + qty);
  farm.markModified('placedItems');
  farm.markModified('inventory');
  await farm.save();

  // Save to user's collection (discoverables, like bugs)
  await UserCollection.create({
    userId,
    category: 'discoverables',
    itemType: picked.itemType,
    size: 1,
    gemsAwarded: 0,
    caughtAt: new Date(),
  });

  log.info({ userId, anchorId, itemType: picked.itemType, qty }, 'Fossil dug');

  const sync = await questService.recordEvents(userId, { kind: 'action', action: 'dig_fossil', itemType: picked.itemType });
  const skillGrant = await skillXpService.grant(userId, 'mining', SKILL_XP_REWARDS.dig_fossil);

  const stateUpdate: StateUpdate = attachSkillXp(
    withQuestSync({
      farmXp: farm.xp,
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
      removedItemIds: [...removeIds],
    }, sync),
    skillGrant,
  );

  return {
    result: { anchorId: anchId, itemType: picked.itemType, label, qty },
    stateUpdate,
  };
}
