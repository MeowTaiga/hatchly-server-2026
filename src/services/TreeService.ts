/**
 * Tree growth and shake/harvest logic.
 * Trees advance 1 stage per calendar day (sapling → in_growth → fully_grown over 3 days).
 * Fruit regrows 3 days after harvest.
 */

import crypto from 'crypto';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { farmService, type StateUpdate, type PlacedItemSnapshot } from './FarmService.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { createLogger } from '../config/logger.js';
import { questService } from './QuestService.js';
import { resolveFarmLevel } from './FarmService.js';

const log = createLogger('TreeService');

const TREE_FOOTPRINT_COLS = 4;
const TREE_FOOTPRINT_ROWS = 4;
const TREE_GROWTH_DAYS = 3;
const FRUIT_REGROW_DAYS = 3;
const MAX_FRUIT_COUNT = 3;

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}

/**
 * Parses compound tree item types (e.g. tree_sappling_oak_peach) into base and fruit.
 * Returns { base: 'tree_sappling_oak', fruit: 'peach' } or { base: itemType } if not compound.
 */
export function parseCompoundTreeItemType(
  itemType: string,
  fruitItemTypes: string[],
): { base: string; fruit?: string } {
  for (const fruit of fruitItemTypes) {
    if (itemType.endsWith('_' + fruit)) {
      return { base: itemType.slice(0, -(fruit.length + 1)), fruit };
    }
  }
  return { base: itemType };
}

/**
 * Extracts the tree variant from itemType (e.g. tree_sappling_oak → oak, tree_sappling_oak_peach → oak_peach).
 */
function getTreeVariant(itemType: string): string | null {
  const m = itemType.match(/^tree_(?:sappling|in_growth|fully_grown)_(.+)$/);
  return m ? m[1] : null;
}

/**
 * Maps tree itemType to the next growth stage.
 * Supports compound types: tree_sappling_oak_peach → tree_in_growth_oak_peach.
 */
function getNextTreeStage(itemType: string): string | null {
  const variant = getTreeVariant(itemType);
  if (!variant) return null;
  if (itemType.startsWith('tree_sappling_')) return `tree_in_growth_${variant}`;
  if (itemType.startsWith('tree_in_growth_')) return `tree_fully_grown_${variant}`;
  return null;
}

const TREE_STAGES = ['sappling', 'in_growth', 'fully_grown'] as const;

/**
 * Ensures compound tree defs exist for each tree variant when a fruit is assigned.
 * Creates tree_sappling_{variant}_{fruit}, tree_in_growth_{variant}_{fruit}, tree_fully_grown_{variant}_{fruit}.
 */
export async function ensureCompoundTreeDefs(
  fruitItemType: string,
  treeVariants: string[],
): Promise<void> {
  if (treeVariants.length === 0) return;

  const fruitDef = await GameItemDef.findOne({ itemType: fruitItemType }).lean();
  if (!fruitDef) {
    log.warn({ fruitItemType }, 'Fruit def not found for compound tree creation');
    return;
  }

  const fruitLabel = fruitDef.label;

  for (const variant of treeVariants) {
    for (const stage of TREE_STAGES) {
      const prefix =
        stage === 'sappling' ? 'tree_sappling_' : stage === 'in_growth' ? 'tree_in_growth_' : 'tree_fully_grown_';
      const baseItemType = `${prefix}${variant}`;
      const compoundItemType = `${baseItemType}_${fruitItemType}`;
      const baseDef = await GameItemDef.findOne({ itemType: baseItemType }).lean();
      if (!baseDef) {
        log.warn({ baseItemType, variant, stage }, 'Base tree def not found for compound');
        continue;
      }
      const treeLabel = baseDef.label;
      const compoundLabel = `${treeLabel} (${fruitLabel})`;

      const compoundPayload: Record<string, unknown> = {
        ...baseDef,
        itemType: compoundItemType,
        label: compoundLabel,
        treeFruit: fruitItemType,
      };
      delete compoundPayload._id;
      delete compoundPayload.createdAt;
      delete compoundPayload.updatedAt;

      await GameItemDef.findOneAndUpdate(
        { itemType: compoundItemType },
        { $set: compoundPayload },
        { upsert: true, runValidators: true },
      );
      log.info({ compoundItemType }, 'Compound tree def ensured');
    }
  }
}

/**
 * Returns the itemType for the given stage and variant.
 */
function getTreeItemType(stage: 'sapling' | 'in_growth' | 'fully_grown', variant: string): string {
  const prefix = stage === 'sapling' ? 'tree_sappling_' : stage === 'in_growth' ? 'tree_in_growth_' : 'tree_fully_grown_';
  return `${prefix}${variant}`;
}

/**
 * Computes tree stage from days since planted (0 = sapling, 1–2 = in_growth, 3+ = fully_grown).
 */
function getStageFromDays(days: number): 'sapling' | 'in_growth' | 'fully_grown' {
  if (days >= TREE_GROWTH_DAYS) return 'fully_grown';
  if (days >= 1) return 'in_growth';
  return 'sapling';
}

/**
 * Days between two YYYY-MM-DD strings (inclusive of start, exclusive of end for "days since").
 */
function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end.getTime() - start.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function genId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function toPlacedSnapshot(item: {
  id: string;
  itemType: string;
  col: number;
  row: number;
  tileCols: number;
  tileRows: number;
  anchorId?: string;
  treePlantedDate?: string;
  treeFruitCount?: number;
  fruitLastHarvestedDate?: string;
}): PlacedItemSnapshot {
  return {
    id: item.id,
    itemType: item.itemType,
    col: item.col,
    row: item.row,
    tileCols: item.tileCols,
    tileRows: item.tileRows,
    anchorId: item.anchorId,
    treePlantedDate: item.treePlantedDate,
    treeFruitCount: item.treeFruitCount,
    fruitLastHarvestedDate: item.fruitLastHarvestedDate,
  };
}

/**
 * Creates placed tiles for a tree at the given stage.
 * Exported for FarmService starter tree placement.
 */
export function createTreeTiles(
  itemType: string,
  col: number,
  row: number,
  treePlantedDate: string,
  treeFruitCount?: number,
  fruitLastHarvestedDate?: string,
): Array<{
  id: string;
  itemType: string;
  col: number;
  row: number;
  tileCols: number;
  tileRows: number;
  anchorId?: string;
  treePlantedDate?: string;
  treeFruitCount?: number;
  fruitLastHarvestedDate?: string;
}> {
  // Placement footprint: sapling 2x2 (1x1 image centered), in_growth 2x2, fully_grown 2x2 (4x4 image scaled)
  const def = itemType.match(/tree_fully_grown_/) ? { cols: 2, rows: 2 } :
    itemType.match(/tree_in_growth_/) ? { cols: 2, rows: 2 } : { cols: 2, rows: 2 };
  const anchorId = genId();
  const items: Array<{
    id: string;
    itemType: string;
    col: number;
    row: number;
    tileCols: number;
    tileRows: number;
    anchorId?: string;
    treePlantedDate?: string;
    treeFruitCount?: number;
    fruitLastHarvestedDate?: string;
  }> = [];
  for (let dr = 0; dr < def.rows; dr++) {
    for (let dc = 0; dc < def.cols; dc++) {
      const isAnchor = dr === 0 && dc === 0;
      items.push({
        id: isAnchor ? anchorId : genId(),
        itemType,
        col: col + dc,
        row: row + dr,
        tileCols: def.cols,
        tileRows: def.rows,
        anchorId: isAnchor ? undefined : anchorId,
        treePlantedDate,
        treeFruitCount: isAnchor ? treeFruitCount : undefined,
        fruitLastHarvestedDate: isAnchor ? fruitLastHarvestedDate : undefined,
      });
    }
  }
  return items;
}

/**
 * Advances all trees on the farm by one growth stage per calendar day.
 * Called on first login of the day (same cadence as dig spot).
 */
export async function advanceTreeGrowth(userId: string, timezone?: string): Promise<void> {
  const farm = await farmService.loadOrCreateFarm(userId);
  const today = getTodayDateStr(timezone);
  const itemDefsMap = await GameItemDef.find().lean();
  const itemDefs = Object.fromEntries(itemDefsMap.map((d) => [d.itemType, d]));

  const anchors = new Map<string, { item: (typeof farm.placedItems)[number]; col: number; row: number }>();
  for (const item of farm.placedItems) {
    const aid = item.anchorId ?? item.id;
    if (item.anchorId) continue;
    const def = itemDefs[item.itemType];
    if (def?.category !== 'tree') continue;
    anchors.set(aid, { item, col: item.col, row: item.row });
  }

  let modified = false;
  for (const { item, col, row } of anchors.values()) {
    const plantedDate = item.treePlantedDate ?? today;
    const days = daysBetween(plantedDate, today);
    const targetStage = getStageFromDays(days);
    const variant = getTreeVariant(item.itemType);
    if (!variant) continue;

    const currentStage: 'sapling' | 'in_growth' | 'fully_grown' =
      item.itemType.startsWith('tree_sappling_') ? 'sapling' :
        item.itemType.startsWith('tree_in_growth_') ? 'in_growth' : 'fully_grown';

    // Never regress: fully grown trees stay fully grown (e.g. starter trees or placed-from-shop)
    if (currentStage === 'fully_grown') {
      // Still handle fruit regrow logic
      const def = itemDefs[item.itemType] as IGameItemDef | undefined;
      const fruitLastHarvested = item.fruitLastHarvestedDate;
      const fruitCount = item.treeFruitCount ?? 0;
      if (def?.treeFruit) {
        const anchId = item.anchorId ?? item.id;
        const toUpdate = farm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
        if (!fruitLastHarvested && fruitCount < MAX_FRUIT_COUNT) {
          for (const t of toUpdate) {
            if (!t.anchorId) {
              (t as { treeFruitCount?: number }).treeFruitCount = MAX_FRUIT_COUNT;
            }
          }
          modified = true;
        } else if (fruitLastHarvested && fruitCount < MAX_FRUIT_COUNT) {
          const daysSinceHarvest = daysBetween(fruitLastHarvested, today);
          if (daysSinceHarvest >= FRUIT_REGROW_DAYS) {
            for (const t of toUpdate) {
              if (!t.anchorId) {
                (t as { treeFruitCount?: number }).treeFruitCount = MAX_FRUIT_COUNT;
                (t as { fruitLastHarvestedDate?: string }).fruitLastHarvestedDate = undefined;
              }
            }
            modified = true;
          }
        }
      }
      continue;
    }

    if (targetStage === currentStage) {
      // Check fruit for fully grown fruit trees
      if (targetStage === 'fully_grown') {
        const def = itemDefs[item.itemType] as IGameItemDef | undefined;
        const fruitLastHarvested = item.fruitLastHarvestedDate;
        const fruitCount = item.treeFruitCount ?? 0;
        if (def?.treeFruit) {
          const anchId = item.anchorId ?? item.id;
          const toUpdate = farm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
          // Backfill: tree never harvested (no fruitLastHarvestedDate) and no fruit → set 3 fruit
          if (!fruitLastHarvested && fruitCount < MAX_FRUIT_COUNT) {
            for (const t of toUpdate) {
              if (!t.anchorId) {
                (t as { treeFruitCount?: number }).treeFruitCount = MAX_FRUIT_COUNT;
              }
            }
            modified = true;
          } else if (fruitLastHarvested && fruitCount < MAX_FRUIT_COUNT) {
            const daysSinceHarvest = daysBetween(fruitLastHarvested, today);
            if (daysSinceHarvest >= FRUIT_REGROW_DAYS) {
              for (const t of toUpdate) {
                if (!t.anchorId) {
                  (t as { treeFruitCount?: number }).treeFruitCount = MAX_FRUIT_COUNT;
                  (t as { fruitLastHarvestedDate?: string }).fruitLastHarvestedDate = undefined;
                }
              }
              modified = true;
            }
          }
        }
      }
      continue;
    }

    const nextItemType = getTreeItemType(targetStage, variant);
    const nextDef = itemDefs[nextItemType];
    if (!nextDef) {
      log.warn({ userId, itemType: item.itemType, nextItemType }, 'Tree stage def not found');
      continue;
    }

    const anchId = item.anchorId ?? item.id;
    const toRemove = farm.placedItems.filter((i) => i.id === anchId || i.anchorId === anchId);
    const removeIds = new Set(toRemove.map((i) => i.id));
    farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

    const anchorItem = toRemove.find((i) => !i.anchorId) ?? toRemove[0];
    const newTiles = createTreeTiles(
      nextItemType,
      col,
      row,
      plantedDate,
      targetStage === 'fully_grown' && nextDef.treeFruit ? MAX_FRUIT_COUNT : undefined,
      undefined,
    );
    farm.placedItems.push(...newTiles);
    modified = true;
    log.info({ userId, from: item.itemType, to: nextItemType }, 'Tree advanced');
  }

  if (modified) {
    farm.markModified('placedItems');
    await farm.save();
  }
}

export interface ShakeTreeResult {
  drops: Array<{ itemType: string; qty: number }>;
  anchorId: string;
}

/**
 * Shakes a tree: drops fruit if fully grown fruit tree with fruit, else harvestYield.
 */
export async function shakeTree(userId: string, anchorId: string): Promise<{
  result: ShakeTreeResult;
  stateUpdate: StateUpdate;
} | null> {
  const farm = await farmService.loadOrCreateFarm(userId);
  const itemDefsMap = await GameItemDef.find().lean();
  const itemDefs = Object.fromEntries(itemDefsMap.map((d) => [d.itemType, d]));

  const target = farm.placedItems.find((i) => i.id === anchorId || i.anchorId === anchorId);
  if (!target) {
    log.warn({ userId, anchorId }, 'Tree not found');
    return null;
  }

  const def = itemDefs[target.itemType];
  if (def?.category !== 'tree') {
    log.warn({ userId, anchorId, itemType: target.itemType }, 'Item is not a tree');
    return null;
  }

  const anchId = target.anchorId ?? target.id;
  const anchorItem = farm.placedItems.find((i) => (i.anchorId ?? i.id) === anchId && !i.anchorId) ?? target;

  const drops: Array<{ itemType: string; qty: number }> = [];
  const isFullyGrown = target.itemType.startsWith('tree_fully_grown_');
  const fruitCount = anchorItem.treeFruitCount ?? 0;
  const treeCol = anchorItem.col;
  const treeRow = anchorItem.row;

  // Only fully grown trees can be harvested; saplings and in_growth give nothing
  if (!isFullyGrown) {
    const treeItems = farm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
    return {
      result: { drops: [], anchorId: anchId },
      stateUpdate: { addedItems: treeItems.map(toPlacedSnapshot) },
    };
  }

  if (def.treeFruit && fruitCount > 0) {
    drops.push({ itemType: def.treeFruit, qty: fruitCount });
    const toUpdate = farm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
    const today = getTodayDateStr();
    for (const t of toUpdate) {
      if (!t.anchorId) {
        (t as { treeFruitCount?: number }).treeFruitCount = 0;
        (t as { fruitLastHarvestedDate?: string }).fruitLastHarvestedDate = today;
      }
    }
    // Add fruit to inventory
    const fruitItemType = def.treeFruit;
    const current = farm.inventory.get(fruitItemType) ?? 0;
    farm.inventory.set(fruitItemType, current + fruitCount);
    farm.markModified('inventory');
  } else if (def.harvestYield?.length) {
    // Stick from fully grown trees: 5% chance, rare
    const STICK_CHANCE = 0.05;
    const stickDef = itemDefs['stick'];
    if (stickDef && Math.random() < STICK_CHANCE) {
      drops.push({ itemType: 'stick', qty: 1 });
      const current = farm.inventory.get('stick') ?? 0;
      farm.inventory.set('stick', current + 1);
      farm.markModified('inventory');
    }
  }

  if (drops.length === 0) {
    log.info({ userId, anchorId }, 'Tree shaken but nothing to drop');
    const treeItems = farm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
    return {
      result: { drops: [], anchorId: anchId },
      stateUpdate: {
        addedItems: treeItems.map(toPlacedSnapshot),
      },
    };
  }

  farm.markModified('placedItems');
  await farm.save();

  await questService.trackAction(userId, 'shake_tree', target.itemType);
  const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
  const freshFarm = autoCompleted.length > 0 ? await farmService.loadOrCreateFarm(userId) : farm;
  const lvl = await resolveFarmLevel(userId, freshFarm.xp);
  const quests = await questService.getQuestsForUser(userId);

  const treeItems = freshFarm.placedItems.filter((i) => (i.anchorId ?? i.id) === anchId);
  const fruitDef = drops.length ? itemDefs[drops[0].itemType] : null;
  const stateUpdate: StateUpdate = {
    farmXp: freshFarm.xp,
    gems: freshFarm.gems,
    inventory: inventoryToRecord(freshFarm.inventory),
    addedItems: treeItems.map(toPlacedSnapshot),
    quests,
    farmLevel: lvl.level,
    canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
    autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
    shakeResult: {
      drops,
      col: treeCol,
      row: treeRow,
      tileCols: anchorItem.tileCols,
      tileRows: anchorItem.tileRows,
      cropEmoji: fruitDef?.emoji,
      cropImageUrl: fruitDef?.imageUrl,
    },
  };

  log.info({ userId, anchorId, drops }, 'Tree shaken');
  return {
    result: { drops, anchorId: anchId },
    stateUpdate,
  };
}
