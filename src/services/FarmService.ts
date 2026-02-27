import { Farm, type IFarm, type IPlacedItem } from '../models/Farm.js';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { Scene } from '../models/Scene.js';
import { SLOT_TO_SUB_CATEGORIES } from '../constants/equipSlots.js';
import { BakedScenery } from '../models/BakedScenery.js';
import { type IDialogStep } from '../models/QuestDef.js';
import { createLogger } from '../config/logger.js';
import { questService, type QuestProgressPayload } from './QuestService.js';
import { petService, type PublicPet } from './PetService.js';
import { petBehaviorStore, PET_DEFAULT_COL, PET_DEFAULT_ROW } from './PetBehaviorStore.js';
import crypto from 'crypto';

const log = createLogger('FarmService');

// ─── XP Config (admin-editable later) ───────────────────────────────────────

export const FARM_XP_REWARDS = {
  place: 3,
  remove: 1,
  harvest: 10,
} as const;

/** Max food items per dish queue. Base 5 + 2 per farm level (e.g. level 1 = 7, level 8 = 21). */
export function getMaxFoodDishQueueSize(farmLevel: number): number {
  return Math.min(25, 5 + farmLevel * 2);
}

export const FARM_LEVELS = [
  { level: 1, xpRequired: 0, title: 'Seedling', emoji: '🌱', cols: 16, rows: 24 },
  { level: 2, xpRequired: 50, title: 'Sprout', emoji: '🌿', cols: 18, rows: 26 },
  { level: 3, xpRequired: 150, title: 'Budding', emoji: '🌸', cols: 20, rows: 28 },
  { level: 4, xpRequired: 350, title: 'Blooming', emoji: '🌻', cols: 22, rows: 30 },
  { level: 5, xpRequired: 600, title: 'Flourishing', emoji: '🌳', cols: 24, rows: 32 },
  { level: 6, xpRequired: 1000, title: 'Thriving', emoji: '✨', cols: 26, rows: 34 },
  { level: 7, xpRequired: 1500, title: 'Bountiful', emoji: '🏆', cols: 28, rows: 36 },
  { level: 8, xpRequired: 2200, title: 'Legendary', emoji: '👑', cols: 32, rows: 40 },
] as const;

/** Default grid size for new farms (level 1). Single source of truth from FARM_LEVELS. */
const DEFAULT_GRID_COLS = FARM_LEVELS[0].cols;
const DEFAULT_GRID_ROWS = FARM_LEVELS[0].rows;

const STARTER_INVENTORY: Record<string, number> = {
  soil: 1,
  wheat_seed: 3,
};

/**
 * Resolves the effective farm level, accounting for completed upgrade quests.
 * A user's effective level is the highest level where:
 *   1. XP >= that level's threshold, AND
 *   2. The upgrade quest for that level is completed (or it's level 1).
 */
export async function resolveFarmLevel(userId: string, xp: number) {
  const completedLevels = await questService.getCompletedFarmLevels(userId);

  for (let i = FARM_LEVELS.length - 1; i >= 0; i--) {
    const lvl = FARM_LEVELS[i];
    if (xp >= lvl.xpRequired && (lvl.level === 1 || completedLevels.has(lvl.level))) {
      return lvl;
    }
  }
  return FARM_LEVELS[0];
}

/** XP-only level resolution (no quest check). Used for XP capping. */
function resolveXpLevel(xp: number) {
  for (let i = FARM_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= FARM_LEVELS[i].xpRequired) return FARM_LEVELS[i];
  }
  return FARM_LEVELS[0];
}

/**
 * Resolves grid dimensions for a farm level. Uses scene dimensions when a scene
 * exists for this level (admin-editable in scene editor); otherwise uses level defaults.
 */
async function resolveGridDimensions(userId: string, xp: number): Promise<{ gridCols: number; gridRows: number }> {
  const level = await resolveFarmLevel(userId, xp);
  const sceneSlug = `farm_${level.cols}x${level.rows}`;
  const scene = await Scene.findOne({ slug: sceneSlug }).select('farmCols farmRows').lean();
  return {
    gridCols: scene?.farmCols ?? level.cols,
    gridRows: scene?.farmRows ?? level.rows,
  };
}

/**
 * Awards XP, capping at the next level's threshold.
 * Once XP reaches the next level's requirement, no more XP is awarded
 * until the user completes the upgrade quest.
 */
function awardXp(farm: IFarm, amount: number): void {
  const currentLevel = resolveXpLevel(farm.xp);
  const nextLevel = FARM_LEVELS.find((l) => l.level === currentLevel.level + 1);
  if (!nextLevel) return; // max level, no more XP
  farm.xp = Math.min(farm.xp + amount, nextLevel.xpRequired);
}

// ─── Snapshot Types ─────────────────────────────────────────────────────────

export interface PlacedItemSnapshot {
  id: string;
  itemType: string;
  col: number;
  row: number;
  tileCols: number;
  tileRows: number;
  anchorId?: string;
  plantedAt?: number;
  growthMs?: number;
  watered?: boolean;
}

export interface EquippedSnapshot {
  handTool?: string;
  bobber?: string;
  bait?: string;
  chair?: string;
}

export interface GameSnapshot {
  farmName: string;
  farmXp: number;
  gems: number;
  farmLevel: number;
  farmLevels: typeof FARM_LEVELS;
  inventory: Record<string, number>;
  placedItems: PlacedItemSnapshot[];
  equipped?: EquippedSnapshot;
  /** Food dish queues keyed by anchorId. */
  foodDishQueues?: Record<string, string[]>;
  itemDefs: Record<string, IGameItemDef>;
  gridCols: number;
  gridRows: number;
  /** Server-authoritative pet state (col, row, behavior). */
  petState?: { col: number; row: number; behavior: string };
  sceneryUrl?: string;
  /** When farm has a scene with baked image, use these for world size instead of padded procedural dims. */
  sceneWorldCols?: number;
  sceneWorldRows?: number;
  quests: QuestProgressPayload[];
  canUpgrade: boolean;
  pendingDialogs?: { questId: string; dialog: IDialogStep[] }[];
}

export interface AutoCompletedQuest {
  questId: string;
  endDialog?: IDialogStep[];
  nextQuestId?: string;
  nextQuestStartDialog?: IDialogStep[];
}

export interface StateUpdate {
  farmXp?: number;
  gems?: number;
  farmLevel?: number;
  inventory?: Record<string, number>;
  equipped?: EquippedSnapshot;
  foodDishQueues?: Record<string, string[]>;
  addedItems?: PlacedItemSnapshot[];
  removedItemIds?: string[];
  movedItems?: PlacedItemSnapshot[];
  farmName?: string;
  quests?: QuestProgressPayload[];
  canUpgrade?: boolean;
  autoCompletedQuests?: AutoCompletedQuest[];
  /** When present, client should apply pet update (e.g. mood raised from farm action). */
  pet?: PublicPet;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function genId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function toPlacedSnapshot(item: IPlacedItem): PlacedItemSnapshot {
  return {
    id: item.id,
    itemType: item.itemType,
    col: item.col,
    row: item.row,
    tileCols: item.tileCols,
    tileRows: item.tileRows,
    anchorId: item.anchorId,
    plantedAt: item.plantedAt ? item.plantedAt.getTime() : undefined,
    growthMs: item.growthMs,
    watered: item.watered,
  };
}

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}

async function loadItemDefsMap(): Promise<Record<string, IGameItemDef>> {
  const defs = await GameItemDef.find().lean();
  const map: Record<string, IGameItemDef> = {};
  for (const d of defs) map[d.itemType] = d;
  return map;
}

/** Returns true if placing a footprint at (col,row) would collide with existing items. */
function hasCollision(
  placedItems: IPlacedItem[],
  col: number,
  row: number,
  cols: number,
  rows: number,
  excludeAnchorId?: string,
): boolean {
  const occupied = new Set<string>();
  for (const item of placedItems) {
    if (excludeAnchorId) {
      const aid = item.anchorId ?? item.id;
      if (aid === excludeAnchorId) continue;
    }
    occupied.add(`${item.col}:${item.row}`);
  }
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      if (occupied.has(`${col + dc}:${row + dr}`)) return true;
    }
  }
  return false;
}

const SOIL_INNER_INSET = 1;

/**
 * Soil cannot be placed on top of the inner plantable area of existing soil.
 * The inner area excludes a 1-tile border (e.g. 6x6 soil has 4x4 plantable center).
 */
function hasSoilOverlap(
  placedItems: IPlacedItem[],
  itemDefsMap: Record<string, { category?: string }>,
  col: number,
  row: number,
  cols: number,
  rows: number,
): boolean {
  const innerKeys = new Set<string>();

  for (const item of placedItems) {
    if (item.anchorId) continue;
    const def = itemDefsMap[item.itemType];
    if (def?.category !== 'soil') continue;

    const sc = item.col;
    const sr = item.row;
    const sCols = item.tileCols;
    const sRows = item.tileRows;
    const innerCols = Math.max(0, sCols - 2 * SOIL_INNER_INSET);
    const innerRows = Math.max(0, sRows - 2 * SOIL_INNER_INSET);
    if (innerCols === 0 || innerRows === 0) continue;

    for (let dr = 0; dr < innerRows; dr++) {
      for (let dc = 0; dc < innerCols; dc++) {
        innerKeys.add(`${sc + SOIL_INNER_INSET + dc}:${sr + SOIL_INNER_INSET + dr}`);
      }
    }
  }

  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      if (innerKeys.has(`${col + dc}:${row + dr}`)) return true;
    }
  }
  return false;
}

/** Returns true if the footprint fits within grid bounds. */
function inBounds(col: number, row: number, cols: number, rows: number, gridCols: number = DEFAULT_GRID_COLS, gridRows: number = DEFAULT_GRID_ROWS): boolean {
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      if (col + dc < 0 || col + dc >= gridCols || row + dr < 0 || row + dr >= gridRows) return false;
    }
  }
  return true;
}

/** Creates placed item tiles for a given definition at a position. */
function createPlacedTiles(
  def: IGameItemDef,
  col: number,
  row: number,
): IPlacedItem[] {
  const anchorId = genId();
  const isCrop = !!def.growthMs;
  const items: IPlacedItem[] = [];
  for (let dr = 0; dr < def.rows; dr++) {
    for (let dc = 0; dc < def.cols; dc++) {
      const isAnchor = dr === 0 && dc === 0;
      items.push({
        id: isAnchor ? anchorId : genId(),
        itemType: def.itemType,
        col: col + dc,
        row: row + dr,
        tileCols: def.cols,
        tileRows: def.rows,
        anchorId: isAnchor ? undefined : anchorId,
        plantedAt: undefined,
        growthMs: isCrop ? def.growthMs : undefined,
        watered: isCrop ? false : undefined,
      });
    }
  }
  return items;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const farmService = {
  /**
   * Loads the user's farm, creating one with starter inventory if it doesn't exist.
   */
  async loadOrCreateFarm(userId: string): Promise<IFarm> {
    let farm = await Farm.findOne({ userId });
    if (!farm) {
      const [houseDef, sellBoxDef, mailBoxDef] = await Promise.all([
        GameItemDef.findOne({ itemType: 'house' }).lean(),
        GameItemDef.findOne({ itemType: 'sell_box' }).lean(),
        GameItemDef.findOne({ itemType: 'mail_box' }).lean(),
      ]);
      const starterPlaced: IPlacedItem[] = [];
      if (houseDef) {
        const houseCol = Math.floor((DEFAULT_GRID_COLS - houseDef.cols) / 2);
        const houseRow = 0;
        starterPlaced.push(...createPlacedTiles(houseDef, houseCol, houseRow));
        if (sellBoxDef) {
          const sellBoxCol = houseCol + houseDef.cols;
          const sellBoxRow = Math.floor((houseDef.rows - sellBoxDef.rows) / 2);
          if (!hasCollision(starterPlaced, sellBoxCol, sellBoxRow, sellBoxDef.cols, sellBoxDef.rows)) {
            starterPlaced.push(...createPlacedTiles(sellBoxDef, sellBoxCol, sellBoxRow));
          }
        }
        if (mailBoxDef) {
          const mailBoxCol = houseCol + houseDef.cols + (sellBoxDef?.cols ?? 2);
          const mailBoxRow = Math.floor((houseDef.rows - mailBoxDef.rows) / 2);
          if (!hasCollision(starterPlaced, mailBoxCol, mailBoxRow, mailBoxDef.cols, mailBoxDef.rows)) {
            starterPlaced.push(...createPlacedTiles(mailBoxDef, mailBoxCol, mailBoxRow));
          }
        }
      }
      farm = await Farm.create({
        userId,
        inventory: new Map(Object.entries(STARTER_INVENTORY)),
        placedItems: starterPlaced,
      });
      log.info({ userId }, 'Created new farm with house');
    } else {
      // Backfill: give existing farms a house if they don't have one
      const hasHouse = farm.placedItems.some((i) => i.itemType === 'house');
      const hasHouseInv = (farm.inventory.get('house') ?? 0) > 0;
      if (!hasHouse && !hasHouseInv) {
        const houseDef = await GameItemDef.findOne({ itemType: 'house' }).lean();
        if (houseDef) {
          const houseCol = Math.floor((DEFAULT_GRID_COLS - houseDef.cols) / 2);
          const houseRow = 0;
          const houseTiles = createPlacedTiles(houseDef, houseCol, houseRow);
          const blocked = hasCollision(farm.placedItems, houseCol, houseRow, houseDef.cols, houseDef.rows);
          if (!blocked) {
            farm.placedItems.push(...houseTiles);
            farm.markModified('placedItems');
          } else {
            farm.inventory.set('house', 1);
            farm.markModified('inventory');
          }
          await farm.save();
          log.info({ userId, placed: !blocked }, 'Backfilled house for existing farm');
        }
      }
    }
    return farm;
  },

  /**
   * Builds the full snapshot the client needs to render the game.
   */
  async getSnapshot(userId: string): Promise<GameSnapshot> {
    const farm = await this.loadOrCreateFarm(userId);
    const itemDefs = await loadItemDefsMap();
    const level = await resolveFarmLevel(userId, farm.xp);

    const { gridCols, gridRows } = await resolveGridDimensions(userId, farm.xp);

    const sceneSlug = `farm_${level.cols}x${level.rows}`;

    // Ensure quest records exist first, then fetch quests + dialogs + scene in parallel
    await questService.ensureUserQuests(userId);
    const [sceneryRecord, quests, canUpgrade, pendingDialogs, scene] = await Promise.all([
      BakedScenery.findOne({ farmCols: gridCols, farmRows: gridRows }).lean(),
      questService.getQuestsForUser(userId),
      questService.canUpgradeFarm(userId, level.level),
      questService.getPendingDialogs(userId),
      Scene.findOne({ slug: sceneSlug }).select('cols rows bakedImageUrl').lean(),
    ]);

    let sceneryUrl = sceneryRecord?.imageUrl;
    let sceneWorldCols: number | undefined;
    let sceneWorldRows: number | undefined;

    if (scene?.bakedImageUrl) {
      sceneryUrl = scene.bakedImageUrl;
      sceneWorldCols = scene.cols;
      sceneWorldRows = scene.rows;
      log.info({ userId, sceneSlug, sceneWorldCols, sceneWorldRows }, 'Snapshot: using scene baked scenery');
    } else if (sceneryRecord?.imageUrl) {
      log.info({ userId, gridCols, gridRows, sceneryUrl: sceneryRecord.imageUrl }, 'Snapshot: using BAKED scenery');
    } else {
      log.info({ userId, gridCols, gridRows }, 'Snapshot: no baked scenery found, client will use procedural fallback');
    }

    const equipped = farm.equipped
      ? {
        ...(farm.equipped.handTool && { handTool: farm.equipped.handTool }),
        ...(farm.equipped.bobber && { bobber: farm.equipped.bobber }),
        ...(farm.equipped.bait && { bait: farm.equipped.bait }),
        ...(farm.equipped.chair && { chair: farm.equipped.chair }),
      }
      : undefined;

    const petEntry = petBehaviorStore.get(userId);
    const spawnCol = farm.petSpawnCol ?? PET_DEFAULT_COL;
    const spawnRow = farm.petSpawnRow ?? PET_DEFAULT_ROW;
    const petState = petEntry
      ? { col: petEntry.col, row: petEntry.row, behavior: petEntry.state }
      : { col: spawnCol, row: spawnRow, behavior: 'idle' as const };

    return {
      farmName: farm.name,
      farmXp: farm.xp,
      gems: farm.gems,
      farmLevel: level.level,
      farmLevels: FARM_LEVELS,
      inventory: inventoryToRecord(farm.inventory),
      placedItems: farm.placedItems.map(toPlacedSnapshot),
      equipped: equipped && Object.keys(equipped).length > 0 ? equipped : undefined,
      foodDishQueues: farm.foodDishQueues && Object.keys(farm.foodDishQueues).length > 0 ? farm.foodDishQueues : undefined,
      itemDefs,
      gridCols,
      gridRows,
      petState,
      sceneryUrl,
      sceneWorldCols,
      sceneWorldRows,
      quests,
      canUpgrade,
      pendingDialogs: pendingDialogs.length > 0 ? pendingDialogs : undefined,
    };
  },

  /**
   * Returns grid dimensions for the user's farm (uses scene when available).
   */
  async getGridDimensions(userId: string): Promise<{ gridCols: number; gridRows: number }> {
    const farm = await this.loadOrCreateFarm(userId);
    return resolveGridDimensions(userId, farm.xp);
  },

  /**
   * Lightweight farm data for PetAIService (placed items, grid size, item defs).
   */
  async getFarmDataForPetAI(userId: string): Promise<{
    placedItems: IPlacedItem[];
    foodDishQueues: Record<string, string[]> | undefined;
    itemDefs: Record<string, IGameItemDef>;
    gridCols: number;
    gridRows: number;
    petSpawnCol: number;
    petSpawnRow: number;
  }> {
    const farm = await this.loadOrCreateFarm(userId);
    const itemDefs = await loadItemDefsMap();
    const level = await resolveFarmLevel(userId, farm.xp);
    const { gridCols, gridRows } = await resolveGridDimensions(userId, farm.xp);
    return {
      placedItems: farm.placedItems,
      foodDishQueues: farm.foodDishQueues,
      itemDefs,
      gridCols,
      gridRows,
      petSpawnCol: farm.petSpawnCol ?? PET_DEFAULT_COL,
      petSpawnRow: farm.petSpawnRow ?? PET_DEFAULT_ROW,
    };
  },

  /**
   * Places an item on the grid. Validates inventory, bounds, and collisions.
   */
  async placeItem(
    userId: string,
    itemType: string,
    col: number,
    row: number,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);
    const def = await GameItemDef.findOne({ itemType }).lean();

    if (!def) throw new Error(`Unknown item type: ${itemType}`);
    if (!def.placeable) throw new Error(`Item ${itemType} is not placeable`);
    if (def.category === 'food') throw new Error('Food cannot be placed; use a food dish instead');

    const { gridCols, gridRows } = await resolveGridDimensions(userId, farm.xp);
    const qty = farm.inventory.get(itemType) ?? 0;
    if (qty <= 0) throw new Error(`No ${itemType} in inventory`);
    if (!inBounds(col, row, def.cols, def.rows, gridCols, gridRows)) throw new Error('Placement out of bounds');

    const isSeed = def.category === 'seed';
    const isSoil = def.category === 'soil';

    if (isSoil) {
      const itemDefsMap = await loadItemDefsMap();
      if (hasSoilOverlap(farm.placedItems, itemDefsMap, col, row, def.cols, def.rows)) {
        throw new Error('Soil cannot be placed on top of the plantable area of another soil patch');
      }
    }

    if (isSeed) {
      const itemDefsMap = await loadItemDefsMap();
      for (let dr = 0; dr < def.rows; dr++) {
        for (let dc = 0; dc < def.cols; dc++) {
          const hasSoil = farm.placedItems.some((i) => {
            if (i.col !== col + dc || i.row !== row + dr) return false;
            return itemDefsMap[i.itemType]?.category === 'soil';
          });
          if (!hasSoil) {
            throw new Error('Seeds can only be planted on soil');
          }
          const hasCrop = farm.placedItems.some((i) => {
            if (i.col !== col + dc || i.row !== row + dr) return false;
            return !!i.growthMs;
          });
          if (hasCrop) {
            throw new Error('There is already a crop planted here');
          }
        }
      }
    }

    const currentLvl = await resolveFarmLevel(userId, farm.xp);
    const newItems = createPlacedTiles(def, col, row);
    farm.placedItems.push(...newItems);
    farm.inventory.set(itemType, qty - 1);
    awardXp(farm, FARM_XP_REWARDS.place);
    farm.markModified('inventory');
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, itemType, col, row }, 'Item placed');

    // Raise pet mood when planting crops or placing decorations
    let pet: PublicPet | undefined;
    if (def.category === 'seed' || def.category === 'decoration') {
      const updated = await petService.raiseMoodFromFarmAction(userId, 2);
      if (updated) pet = updated;
    }

    // Track action + auto-complete eligible quests + refresh
    await questService.trackAction(userId, 'place', itemType);
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvlAfter = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      farmXp: freshFarm.xp,
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      addedItems: newItems.map(toPlacedSnapshot),
      quests,
      farmLevel: lvlAfter.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvlAfter.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
      ...(pet && { pet }),
    };

    return update;
  },

  /**
   * Removes an item (and its multi-tile siblings) from the grid.
   * @param opts.consume - If true, item is consumed (e.g. pet eating) — not returned to inventory, no remove XP.
   */
  async removeItem(userId: string, itemId: string, opts?: { consume?: boolean }): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);

    const target = farm.placedItems.find(
      (i) => i.id === itemId || i.anchorId === itemId,
    );
    if (!target) throw new Error('Item not found on grid');

    const anchId = target.anchorId ?? target.id;
    const toRemove = farm.placedItems.filter(
      (i) => i.id === anchId || i.anchorId === anchId,
    );
    if (toRemove.length === 0) throw new Error('No tiles found for item');

    const removeIds = new Set(toRemove.map((i) => i.id));
    farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

    if (!opts?.consume) {
      const currentQty = farm.inventory.get(target.itemType) ?? 0;
      farm.inventory.set(target.itemType, currentQty + 1);
      awardXp(farm, FARM_XP_REWARDS.remove);
      farm.markModified('inventory');
    }
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, itemId, itemType: target.itemType, consume: opts?.consume }, 'Item removed');

    // Track action + auto-complete eligible quests + refresh (skip for consumed items)
    if (!opts?.consume) {
      await questService.trackAction(userId, 'remove', target.itemType);
    }
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvl = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      farmXp: freshFarm.xp,
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      removedItemIds: [...removeIds],
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
    };

    return update;
  },

  /**
   * Harvests a mature crop. Validates growth timer server-side.
   */
  async harvestCrop(userId: string, itemId: string): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);

    const target = farm.placedItems.find((i) => i.id === itemId);
    if (!target) throw new Error('Item not found on grid');
    if (!target.plantedAt || !target.growthMs) throw new Error('Not a crop');
    if (!target.watered) throw new Error('Crop needs water first');

    const elapsed = Date.now() - target.plantedAt.getTime();
    if (elapsed < target.growthMs) throw new Error('Crop not yet mature');

    const def = await GameItemDef.findOne({ itemType: target.itemType }).lean();
    if (!def?.harvestYield?.length) throw new Error('Item has no harvest yield');

    const anchId = target.anchorId ?? target.id;
    const toRemove = farm.placedItems.filter(
      (i) => i.id === anchId || i.anchorId === anchId,
    );
    const removeIds = new Set(toRemove.map((i) => i.id));
    farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

    for (const drop of def.harvestYield) {
      const current = farm.inventory.get(drop.itemType) ?? 0;
      farm.inventory.set(drop.itemType, current + drop.qty);
    }

    awardXp(farm, FARM_XP_REWARDS.harvest);
    farm.markModified('inventory');
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, itemId, itemType: target.itemType, yields: def.harvestYield }, 'Crop harvested');

    // Track harvest for the seed type AND each yielded item type
    const trackTypes = new Set<string>([target.itemType]);
    for (const drop of def.harvestYield) trackTypes.add(drop.itemType);
    for (const t of trackTypes) {
      await questService.trackAction(userId, 'harvest', t);
    }
    // Track crop_grown (crop reached harvestable state) for the harvested crop type
    await questService.trackCropGrown(userId, target.itemType);

    // Auto-complete eligible quests + refresh
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvl = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      farmXp: freshFarm.xp,
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      removedItemIds: [...removeIds],
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
    };

    return update;
  },

  /**
   * Renames the farm (max 24 characters).
   */
  async renameFarm(userId: string, name: string): Promise<StateUpdate> {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed.length === 0) throw new Error('Farm name cannot be empty');

    const farm = await this.loadOrCreateFarm(userId);
    farm.name = trimmed;
    await farm.save();

    log.info({ userId, name: trimmed }, 'Farm renamed');

    return { farmName: trimmed };
  },

  /**
   * Moves an existing placed item to a new grid position.
   */
  async moveItem(
    userId: string,
    itemId: string,
    newCol: number,
    newRow: number,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);

    const target = farm.placedItems.find((i) => i.id === itemId);
    if (!target) throw new Error('Item not found on grid');

    const anchId = target.anchorId ?? target.id;
    const def = await GameItemDef.findOne({ itemType: target.itemType }).lean();
    if (!def) throw new Error(`Unknown item type: ${target.itemType}`);

    const { gridCols, gridRows } = await resolveGridDimensions(userId, farm.xp);
    if (!inBounds(newCol, newRow, def.cols, def.rows, gridCols, gridRows)) throw new Error('Move destination out of bounds');

    const anchorItem = farm.placedItems.find((i) => i.id === anchId) ?? target;

    const oldIds = farm.placedItems
      .filter((i) => i.id === anchId || i.anchorId === anchId)
      .map((i) => i.id);
    farm.placedItems = farm.placedItems.filter((i) => !oldIds.includes(i.id));

    if (def.category === 'soil') {
      const itemDefsMap = await loadItemDefsMap();
      if (hasSoilOverlap(farm.placedItems, itemDefsMap, newCol, newRow, def.cols, def.rows)) {
        throw new Error('Soil cannot be placed on top of the plantable area of another soil patch');
      }
    }

    const newItems: IPlacedItem[] = [];
    for (let dr = 0; dr < def.rows; dr++) {
      for (let dc = 0; dc < def.cols; dc++) {
        const isAnchor = dr === 0 && dc === 0;
        newItems.push({
          id: isAnchor ? anchId : genId(),
          itemType: target.itemType,
          col: newCol + dc,
          row: newRow + dr,
          tileCols: def.cols,
          tileRows: def.rows,
          anchorId: isAnchor ? undefined : anchId,
          plantedAt: anchorItem.plantedAt,
          growthMs: anchorItem.growthMs,
          watered: anchorItem.watered,
        });
      }
    }

    farm.placedItems.push(...newItems);
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, itemId, newCol, newRow }, 'Item moved');

    return {
      removedItemIds: oldIds,
      addedItems: newItems.map(toPlacedSnapshot),
    };
  },


  /**
   * Waters a seed/crop tile, setting `watered = true` and starting the growth timer.
   */
  async waterTile(userId: string, col: number, row: number): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);

    const target = farm.placedItems.find(
      (i) => i.col === col && i.row === row && !!i.growthMs,
    );
    if (!target) throw new Error('No crop at this tile to water');
    if (target.watered) throw new Error('Already watered');

    target.watered = true;
    target.plantedAt = new Date();

    const anchId = target.anchorId ?? target.id;
    for (const item of farm.placedItems) {
      if (item.id === anchId || item.anchorId === anchId) {
        item.watered = true;
        item.plantedAt = target.plantedAt;
      }
    }

    farm.markModified('placedItems');
    await farm.save();

    const wateredTiles = farm.placedItems.filter(
      (i) => i.id === anchId || i.anchorId === anchId,
    );

    log.info({ userId, col, row, itemType: target.itemType }, 'Tile watered');

    await questService.trackAction(userId, 'water', target.itemType);
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvl = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      farmXp: freshFarm.xp,
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      addedItems: wateredTiles.map(toPlacedSnapshot),
      removedItemIds: wateredTiles.map((i) => i.id),
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
    };

    return update;
  },

  /**
   * Purchases an item from the shop using gems.
   */
  async purchaseItem(userId: string, itemType: string): Promise<StateUpdate> {
    const def = await GameItemDef.findOne({ itemType }).lean();
    if (!def) throw new Error(`Unknown item type: ${itemType}`);
    if (!def.buyable) throw new Error('This item is not for sale');
    if (!def.gemPrice || def.gemPrice <= 0) throw new Error('Item has no price set');

    const farm = await this.loadOrCreateFarm(userId);
    if (farm.gems < def.gemPrice) throw new Error('Not enough gems');

    farm.gems -= def.gemPrice;
    const current = farm.inventory.get(itemType) ?? 0;
    farm.inventory.set(itemType, current + 1);
    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, itemType, cost: def.gemPrice, remaining: farm.gems }, 'Item purchased');

    await questService.trackAction(userId, 'purchase', itemType);
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvl = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
    };

    return update;
  },

  /**
   * Sells an item back to the shop for gems.
   * All items are sellable; default sell price is 0 (clears inventory without gem reward).
   */
  async sellItem(userId: string, itemType: string, qty: number = 1): Promise<StateUpdate> {
    const def = await GameItemDef.findOne({ itemType }).lean();
    if (!def) throw new Error(`Unknown item type: ${itemType}`);
    if (def.sellable === false) throw new Error(`Item ${itemType} cannot be sold`);

    const pricePerItem = typeof def.sellPrice === 'number' ? def.sellPrice : 0;

    const farm = await this.loadOrCreateFarm(userId);
    const current = farm.inventory.get(itemType) ?? 0;
    const sellQty = Math.min(qty, current);
    if (sellQty <= 0) throw new Error('Not enough items to sell');

    const totalGems = pricePerItem * sellQty;
    farm.gems += totalGems;
    const newQty = current - sellQty;
    if (newQty <= 0) farm.inventory.delete(itemType);
    else farm.inventory.set(itemType, newQty);
    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, itemType, qty: sellQty, gems: totalGems, remaining: farm.gems }, 'Item sold');

    const lvl = await resolveFarmLevel(userId, farm.xp);
    const quests = await questService.getQuestsForUser(userId);

    const update: StateUpdate = {
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
    };

    return update;
  },

  /**
   * Sells multiple items in one transaction. All items are sellable (default sellPrice 0).
   */
  async sellItemsBatch(
    userId: string,
    items: Array<{ itemType: string; qty: number }>,
  ): Promise<StateUpdate> {
    if (!items.length) throw new Error('No items to sell');
    if (items.length > 50) throw new Error('Batch too large (max 50)');

    const farm = await this.loadOrCreateFarm(userId);
    const defsMap = await loadItemDefsMap();
    let totalGems = 0;

    for (const { itemType, qty } of items) {
      if (qty <= 0) continue;
      const def = defsMap[itemType];
      if (!def || def.sellable === false) continue;
      const current = farm.inventory.get(itemType) ?? 0;
      const sellQty = Math.min(qty, current);
      if (sellQty <= 0) continue;

      const pricePerItem = typeof def.sellPrice === 'number' ? def.sellPrice : 0;
      totalGems += pricePerItem * sellQty;
      const newQty = current - sellQty;
      if (newQty <= 0) farm.inventory.delete(itemType);
      else farm.inventory.set(itemType, newQty);
    }

    farm.gems += totalGems;
    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, itemCount: items.length, totalGems }, 'Items sold (batch)');

    const lvl = await resolveFarmLevel(userId, farm.xp);
    const quests = await questService.getQuestsForUser(userId);

    return {
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
      quests,
      farmLevel: lvl.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvl.level),
    };
  },

  /**
   * Updates equipped items. Validates that itemTypes exist in inventory and match slot subCategory.
   * handTool: mutually exclusive (fishing pole, bug net, pickaxe, etc.)
   */
  async setEquipped(
    userId: string,
    slot: 'handTool' | 'bobber' | 'bait' | 'chair',
    itemType: string | null,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);
    const itemDefsMap = await loadItemDefsMap();

    if (!farm.equipped) {
      farm.equipped = {};
    }

    const allowed = SLOT_TO_SUB_CATEGORIES[slot];
    const allowedList = Array.isArray(allowed) ? allowed : [allowed];

    if (itemType) {
      const def = itemDefsMap[itemType];
      if (!def) throw new Error(`Unknown item type: ${itemType}`);
      if (!def.subCategory || !allowedList.includes(def.subCategory)) {
        throw new Error(`Item ${itemType} cannot be equipped in ${slot} slot`);
      }
      const qty = farm.inventory.get(itemType) ?? 0;
      if (qty <= 0) throw new Error(`No ${itemType} in inventory`);
    }

    const key = slot as keyof typeof farm.equipped;
    farm.equipped[key] = itemType ?? undefined;
    if (itemType === null || itemType === '') {
      delete farm.equipped[key];
    }
    farm.markModified('equipped');
    await farm.save();

    log.info({ userId, slot, itemType }, 'Equipped updated');

    const equipped: EquippedSnapshot = {
      ...(farm.equipped.handTool && { handTool: farm.equipped.handTool }),
      ...(farm.equipped.bobber && { bobber: farm.equipped.bobber }),
      ...(farm.equipped.bait && { bait: farm.equipped.bait }),
      ...(farm.equipped.chair && { chair: farm.equipped.chair }),
    };

    // Always return an object; JSON.stringify omits undefined, so the client would never receive
    // the equipped key when all slots are empty and couldn't update its state.
    return { equipped: Object.keys(equipped).length > 0 ? equipped : {} };
  },

  /**
   * Adds food items to a food dish queue. Validates anchorId is a food_dish item.
   * Queue size is capped by farm level (see getMaxFoodDishQueueSize).
   */
  async addToFoodDish(
    userId: string,
    anchorId: string,
    items: Array<{ itemType: string; qty: number }>,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);
    const itemDefsMap = await loadItemDefsMap();
    const level = await resolveFarmLevel(userId, farm.xp);
    const maxQueueSize = getMaxFoodDishQueueSize(level.level);

    const placed = farm.placedItems.find((i) => i.id === anchorId || i.anchorId === anchorId);
    if (!placed) throw new Error('Food dish not found');
    const dishDef = itemDefsMap[placed.itemType];
    if (!dishDef || dishDef.interactAction?.payload !== 'food_dish') {
      throw new Error('Item is not a food dish');
    }

    if (!farm.foodDishQueues) farm.foodDishQueues = {};
    let queue = farm.foodDishQueues[anchorId];
    if (!queue) queue = farm.foodDishQueues[anchorId] = [];

    const currentSize = queue.length;
    let toAdd = 0;
    for (const { qty } of items) {
      if (qty <= 0) continue;
      toAdd += qty;
    }
    const spaceLeft = Math.max(0, maxQueueSize - currentSize);
    if (toAdd > spaceLeft) {
      throw new Error(`Food dish can hold at most ${maxQueueSize} items (${spaceLeft} space left). Upgrade your farm to increase capacity.`);
    }

    for (const { itemType, qty } of items) {
      if (qty <= 0) continue;
      const def = itemDefsMap[itemType];
      if (!def || def.category !== 'food') throw new Error(`${itemType} is not food`);
      const have = farm.inventory.get(itemType) ?? 0;
      if (have < qty) throw new Error(`Not enough ${itemType} in inventory`);
      farm.inventory.set(itemType, have - qty);
      for (let i = 0; i < qty; i++) queue.push(itemType);
    }

    farm.markModified('inventory');
    farm.markModified('foodDishQueues');
    await farm.save();

    log.info({ userId, anchorId, itemCount: items.reduce((s, x) => s + x.qty, 0) }, 'Added to food dish');

    return {
      inventory: inventoryToRecord(farm.inventory),
      foodDishQueues: { ...farm.foodDishQueues },
    };
  },

  /**
   * Consumes the first food from a food dish queue. Returns itemType and state update, or null if empty.
   */
  async consumeFromFoodDish(userId: string, anchorId: string): Promise<{ itemType: string; update: StateUpdate } | null> {
    const farm = await this.loadOrCreateFarm(userId);
    const itemDefsMap = await loadItemDefsMap();

    const placed = farm.placedItems.find((i) => i.id === anchorId || i.anchorId === anchorId);
    if (!placed) return null;
    const dishDef = itemDefsMap[placed.itemType];
    if (!dishDef || dishDef.interactAction?.payload !== 'food_dish') return null;

    const queue = farm.foodDishQueues?.[anchorId];
    if (!queue || queue.length === 0) return null;

    const itemType = queue.shift()!;
    if (queue.length === 0) delete farm.foodDishQueues![anchorId];
    farm.markModified('foodDishQueues');
    await farm.save();

    return {
      itemType,
      update: { foodDishQueues: { ...(farm.foodDishQueues ?? {}) } },
    };
  },

  /**
   * Batch crop operations: plant, water, harvest in a single DB save.
   * Reduces server load when spam-tapping by processing all ops atomically.
   * Failing individual ops are skipped (partial batch success).
   */
  async cropBatch(
    userId: string,
    ops: Array<
      | { type: 'plant'; itemType: string; col: number; row: number }
      | { type: 'water'; col: number; row: number }
      | { type: 'harvest'; anchorId: string }
    >,
  ): Promise<StateUpdate & { failedOps?: number[] }> {
    if (!ops.length) throw new Error('Empty batch');
    if (ops.length > 50) throw new Error('Batch too large (max 50)');

    const farm = await this.loadOrCreateFarm(userId);
    const defsMap = await loadItemDefsMap();
    const { gridCols, gridRows } = await resolveGridDimensions(userId, farm.xp);
    const failedOps: number[] = [];
    const allAdded: IPlacedItem[] = [];
    const allRemovedIds: string[] = [];
    const trackActions: { action: string; itemType: string }[] = [];
    let totalXp = 0;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      try {
        if (op.type === 'plant') {
          const def = defsMap[op.itemType];
          if (!def) { failedOps.push(i); continue; }
          if (!def.placeable) { failedOps.push(i); continue; }
          const qty = farm.inventory.get(op.itemType) ?? 0;
          if (qty <= 0) { failedOps.push(i); continue; }
          if (!inBounds(op.col, op.row, def.cols, def.rows, gridCols, gridRows)) { failedOps.push(i); continue; }

          if (def.category === 'seed') {
            let seedValid = true;
            for (let dr = 0; dr < def.rows && seedValid; dr++) {
              for (let dc = 0; dc < def.cols && seedValid; dc++) {
                const hasSoil = farm.placedItems.some((it) =>
                  it.col === op.col + dc && it.row === op.row + dr && defsMap[it.itemType]?.category === 'soil',
                );
                if (!hasSoil) seedValid = false;
                const hasCrop = farm.placedItems.some((it) =>
                  it.col === op.col + dc && it.row === op.row + dr && !!it.growthMs,
                );
                if (hasCrop) seedValid = false;
              }
            }
            if (!seedValid) { failedOps.push(i); continue; }
          }

          const newItems = createPlacedTiles(def, op.col, op.row);
          farm.placedItems.push(...newItems);
          farm.inventory.set(op.itemType, qty - 1);
          allAdded.push(...newItems);
          totalXp += FARM_XP_REWARDS.place;
          trackActions.push({ action: 'place', itemType: op.itemType });
        } else if (op.type === 'water') {
          const target = farm.placedItems.find(
            (it) => it.col === op.col && it.row === op.row && !!it.growthMs && !it.watered,
          );
          if (!target) { failedOps.push(i); continue; }

          target.watered = true;
          target.plantedAt = new Date();
          const anchId = target.anchorId ?? target.id;
          for (const item of farm.placedItems) {
            if (item.id === anchId || item.anchorId === anchId) {
              item.watered = true;
              item.plantedAt = target.plantedAt;
            }
          }
          trackActions.push({ action: 'water', itemType: target.itemType });
        } else if (op.type === 'harvest') {
          const target = farm.placedItems.find((it) => it.id === op.anchorId);
          if (!target || !target.plantedAt || !target.growthMs || !target.watered) {
            failedOps.push(i);
            continue;
          }
          const elapsed = Date.now() - target.plantedAt.getTime();
          if (elapsed < target.growthMs) { failedOps.push(i); continue; }

          const def = defsMap[target.itemType];
          if (!def?.harvestYield?.length) { failedOps.push(i); continue; }

          const anchId = target.anchorId ?? target.id;
          const toRemove = farm.placedItems.filter(
            (it) => it.id === anchId || it.anchorId === anchId,
          );
          const removeIds = toRemove.map((it) => it.id);
          allRemovedIds.push(...removeIds);
          const removeSet = new Set(removeIds);
          farm.placedItems = farm.placedItems.filter((it) => !removeSet.has(it.id));

          for (const drop of def.harvestYield) {
            const current = farm.inventory.get(drop.itemType) ?? 0;
            farm.inventory.set(drop.itemType, current + drop.qty);
          }

          totalXp += FARM_XP_REWARDS.harvest;
          trackActions.push({ action: 'harvest', itemType: target.itemType });
          for (const drop of def.harvestYield) {
            trackActions.push({ action: 'harvest', itemType: drop.itemType });
          }
        }
      } catch {
        failedOps.push(i);
      }
    }

    // Apply aggregated XP
    if (totalXp > 0) awardXp(farm, totalXp);

    farm.markModified('inventory');
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, opCount: ops.length, failed: failedOps.length }, 'Crop batch processed');

    // Track quest actions (parallelized)
    const uniqueActions = new Map<string, Set<string>>();
    const harvestCropTypes = new Set<string>();
    for (const ta of trackActions) {
      if (!uniqueActions.has(ta.action)) uniqueActions.set(ta.action, new Set());
      uniqueActions.get(ta.action)!.add(ta.itemType);
      if (ta.action === 'harvest') harvestCropTypes.add(ta.itemType);
    }
    const trackPromises: Promise<unknown>[] = [];
    for (const [action, itemTypes] of uniqueActions) {
      for (const itemType of itemTypes) {
        trackPromises.push(questService.trackAction(userId, action, itemType));
      }
    }
    for (const itemType of harvestCropTypes) {
      trackPromises.push(questService.trackCropGrown(userId, itemType));
    }
    await Promise.all(trackPromises);

    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);
    const freshFarm = autoCompleted.length > 0 ? await this.loadOrCreateFarm(userId) : farm;
    const lvlAfter = await resolveFarmLevel(userId, freshFarm.xp);
    const quests = await questService.getQuestsForUser(userId);

    // Build the watered items list for addedItems (deduplicated by ID)
    const wateredAddedMap = new Map<string, IPlacedItem>();
    const wateredRemovedIdSet = new Set<string>();
    for (const op of ops) {
      if (op.type !== 'water') continue;
      const directHit = freshFarm.placedItems.find(
        (d) => d.col === op.col && d.row === op.row && !!d.growthMs,
      );
      if (!directHit) continue;

      const aId = directHit.anchorId ?? directHit.id;
      const siblings = freshFarm.placedItems.filter(
        (it) => it.id === aId || it.anchorId === aId,
      );
      for (const it of siblings) {
        wateredAddedMap.set(it.id, it);
        wateredRemovedIdSet.add(it.id);
      }
    }

    // Merge everything into unique lists
    const addedMap = new Map<string, PlacedItemSnapshot>();
    for (const it of allAdded) addedMap.set(it.id, toPlacedSnapshot(it));
    for (const it of wateredAddedMap.values()) addedMap.set(it.id, toPlacedSnapshot(it));

    const finalRemovedIds = new Set<string>([...allRemovedIds, ...wateredRemovedIdSet]);

    let pet: PublicPet | undefined;
    const hasPlant = ops.some((o) => o.type === 'plant');
    if (hasPlant) {
      const updated = await petService.raiseMoodFromFarmAction(userId, 2);
      if (updated) pet = updated;
    }

    const update: StateUpdate & { failedOps?: number[] } = {
      farmXp: freshFarm.xp,
      gems: freshFarm.gems,
      inventory: inventoryToRecord(freshFarm.inventory),
      addedItems: Array.from(addedMap.values()),
      removedItemIds: Array.from(finalRemovedIds),
      quests,
      farmLevel: lvlAfter.level,
      canUpgrade: await questService.canUpgradeFarm(userId, lvlAfter.level),
      autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
      ...(pet && { pet }),
      ...(failedOps.length > 0 && { failedOps }),
    };

    return update;
  },

  /** Resolves effective farm level (used by admin routes). */
  resolveFarmLevel,
};
