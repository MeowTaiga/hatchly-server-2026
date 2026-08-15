import { Farm, type IFarm, type IPlacedItem } from '../models/Farm.js';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { getTodayDateStr, getDaysAgoDateStr } from '../utils/getYesterdaySummary.js';
import { Scene } from '../models/Scene.js';
import { SLOT_TO_SUB_CATEGORIES } from '../constants/equipSlots.js';
import { BakedScenery } from '../models/BakedScenery.js';
import { createLogger } from '../config/logger.js';
import {
  questService,
  type QuestCompletion,
  type QuestDialog,
  type QuestEvent,
  type QuestPayload,
  type QuestSync,
} from './quests/index.js';
import { petService, type PublicPet } from './PetService.js';
import { petBehaviorStore, PET_DEFAULT_COL, PET_DEFAULT_ROW } from './PetBehaviorStore.js';
import { createTreeTiles } from './TreeService.js';
import { ensureStarterCraftingRecipes } from './StarterCraftingRecipes.js';
import { syncCraftingRecipesThroughLevel } from './CraftingLevelRecipeUnlocks.js';
import { syncCookingRecipesThroughLevel } from './CookingLevelRecipeUnlocks.js';
import { syncFarmingSoilThroughLevel } from './FarmingLevelSoilGrants.js';
import {
  appendFossilHoles,
  buildPlacedItemsWithDailyGroundPickups,
} from './GroundPickupService.js';
import { User } from '../models/User.js';
import { UserQuest } from '../models/UserQuest.js';
import { weatherService, type ActiveWeather } from './WeatherService.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { STARTER_NPC_DEPARTURE_QUEST_ID, STARTER_NPC_ITEM_TYPE } from './quests/constants.js';
import { attachSkillXp, getUserSkillLevel, skillXpService } from './SkillXpService.js';
import { backpackSlotsFromCraftingLevel, harvestSeedReturnChance } from '../constants/skillPerks.js';
import { syncMiningEnergy, miningEnergyStateUpdate } from './MiningEnergy.js';
import type { SkillXpStatePayload } from './SkillXpService.js';
import {
  addToBackpack,
  canFitInBackpack,
  getBackpackSlots,
  grantLoot,
  mapToRecord,
  takeFromBackpack,
  takeFromStorage,
  addToStorage,
} from './inventoryCapacity.js';
import crypto from 'crypto';

const log = createLogger('FarmService');

/**
 * Grants produce from harvestYield (never the planted seed) plus a farming-perk
 * roll for a single seed return. Guaranteed self-seed drops in item defs are
 * ignored even if a stale def still lists them.
 */
function grantCropHarvestLoot(
  farm: IFarm,
  plantedItemType: string,
  harvestYield: { itemType: string; qty: number }[],
  farmingLevel: number,
): string[] {
  const yielded: string[] = [];
  for (const drop of harvestYield) {
    if (drop.itemType === plantedItemType) continue;
    grantLoot(farm, drop.itemType, drop.qty);
    yielded.push(drop.itemType);
  }
  const chance = harvestSeedReturnChance(farmingLevel);
  if (chance > 0 && Math.random() * 100 < chance) {
    grantLoot(farm, plantedItemType, 1);
    yielded.push(plantedItemType);
  }
  return yielded;
}

/** Farm-placed house occupies 2 rows; art overflows that pad via centerOverflow. */
const HOUSE_PLACE_ROWS = 2;
/** Sell box & mailbox sit on the first farm row by default. */
const STARTER_YARD_TOP_ROW = 0;
const STARTER_BOX_TYPES = ['sell_box', 'mail_box'] as const;

/** Sync farm.backpackSlots from crafting skill milestones (server source of truth). */
async function syncBackpackSlotsFromCrafting(userId: string, farm: IFarm): Promise<number> {
  const craftingLevel = await getUserSkillLevel(userId, 'crafting');
  const slots = backpackSlotsFromCraftingLevel(craftingLevel);
  if (farm.backpackSlots !== slots) {
    farm.backpackSlots = slots;
    farm.markModified('backpackSlots');
  }
  return slots;
}

/** Keeps first occurrence of each placed-item id (repairs accidental double-pushes). */
function dedupePlacedItemsById(items: IPlacedItem[]): { items: IPlacedItem[]; removed: number } {
  const seen = new Set<string>();
  const out: IPlacedItem[] = [];
  let removed = 0;
  for (const item of items) {
    if (seen.has(item.id)) {
      removed += 1;
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return { items: out, removed };
}

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

/** Fallback for inBounds when dimensions not provided. Prefer resolveGridDimensions for actual farm size. */
const DEFAULT_GRID_COLS = FARM_LEVELS[0].cols;
const DEFAULT_GRID_ROWS = FARM_LEVELS[0].rows;

/** New farms start empty. Soil and wheat seeds come from Bramble; more soil from farming levels. */
const STARTER_INVENTORY: Record<string, number> = {};

export type FarmLevelDef = (typeof FARM_LEVELS)[number];

/**
 * The farm's level definition. Level is a stored field raised only by finishing
 * that level's upgrade quest, so this is a plain lookup — no database round trip
 * and no inferring the level from quest ids.
 */
export function farmLevelOf(farm: Pick<IFarm, 'farmLevel'>): FarmLevelDef {
  const level = farm.farmLevel ?? 1;
  return FARM_LEVELS.find((l) => l.level === level) ?? FARM_LEVELS[0];
}

export function farmLevelByNumber(level: number): FarmLevelDef {
  return FARM_LEVELS.find((l) => l.level === level) ?? FARM_LEVELS[0];
}

/**
 * Grid dimensions for a farm. Prefers the scene authored for this level so the
 * admin scene editor stays the source of truth for playable area.
 */
async function resolveGridDimensions(farm: Pick<IFarm, 'farmLevel'>): Promise<{ gridCols: number; gridRows: number }> {
  const level = farmLevelOf(farm);
  const sceneSlug = `farm_${level.cols}x${level.rows}`;
  const scene = await Scene.findOne({ slug: sceneSlug }).select('farmCols farmRows').lean();
  return {
    gridCols: scene?.farmCols ?? level.cols,
    gridRows: scene?.farmRows ?? level.rows,
  };
}

/**
 * XP accumulates without a ceiling. It used to be clamped at the next level's
 * threshold to force players through the upgrade quest, which just looked like
 * the XP bar had frozen; the quest itself is the gate, so authors who want XP to
 * matter add a farmXp requirement to it.
 */
function awardXp(farm: IFarm, amount: number): void {
  farm.xp += amount;
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
  treePlantedDate?: string;
  treeFruitCount?: number;
  fruitLastHarvestedDate?: string;
}

export interface EquippedSnapshot {
  handTool?: string;
  bobber?: string;
  bait?: string;
  chair?: string;
}

export interface ScenePlacementSnapshot {
  id: string;
  itemType: string;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  depthOffset?: number;
  rotationDegrees?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Not baked — client draws as a depth-sorted sprite. */
  live?: boolean;
}

export interface GameSnapshot {
  farmName: string;
  farmXp: number;
  gems: number;
  farmLevel: number;
  farmLevels: typeof FARM_LEVELS;
  inventory: Record<string, number>;
  /** Farm-wide vault (uncapped). */
  storage: Record<string, number>;
  /** Max backpack stacks. */
  backpackSlots: number;
  /** Mining stamina remaining after regen. */
  miningEnergy: number;
  miningEnergyCap: number;
  /** Epoch ms when miningEnergy was last accurate. */
  miningEnergyAt: number;
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
  /** Sent alongside a scene bake so taps can still hit-test what the PNG flattened. */
  scenePlacements?: ScenePlacementSnapshot[];
  quests: QuestPayload[];
  canUpgrade: boolean;
  questDialogs?: QuestDialog[];
  /** Shared US world weather (America/New_York calendar). */
  weather: ActiveWeather;
}

export interface StateUpdate {
  farmXp?: number;
  gems?: number;
  farmLevel?: number;
  inventory?: Record<string, number>;
  storage?: Record<string, number>;
  backpackSlots?: number;
  miningEnergy?: number;
  miningEnergyCap?: number;
  miningEnergyAt?: number;
  equipped?: EquippedSnapshot;
  foodDishQueues?: Record<string, string[]>;
  addedItems?: PlacedItemSnapshot[];
  removedItemIds?: string[];
  movedItems?: PlacedItemSnapshot[];
  farmName?: string;
  quests?: QuestPayload[];
  canUpgrade?: boolean;
  /** Quests that finished as a result of this action, for the reward celebration. */
  questCompletions?: QuestCompletion[];
  /** Dialogs the app should present, in order. */
  questDialogs?: QuestDialog[];
  /** When present, client should apply pet update (e.g. mood raised from farm action). */
  pet?: PublicPet;
  /** Skill XP earned by this action — client syncs HUD + shows feedback. */
  skillXp?: SkillXpStatePayload;
  /** Tree shake result — client shows jiggle+shrink harvest effect and bubble. */
  shakeResult?: {
    drops: Array<{ itemType: string; qty: number }>;
    col: number;
    row: number;
    tileCols: number;
    tileRows: number;
    cropEmoji?: string;
    cropImageUrl?: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Folds a quest sync into a state update. Every gameplay action reports quest
 * progress the same way through this, rather than each one re-deriving the
 * level, the upgrade flag and the quest list for itself.
 *
 * The farm fields are only overwritten when a completion actually changed the
 * economy, so an action's own inventory/gems numbers survive untouched.
 */
export function withQuestSync(update: StateUpdate, sync: QuestSync): StateUpdate {
  update.quests = sync.quests;
  update.canUpgrade = sync.canUpgrade;
  update.farmLevel = sync.farmLevel;

  if (sync.farmChanged) {
    update.inventory = sync.inventory;
    update.gems = sync.gems;
    update.farmXp = sync.farmXp;
  }
  if (sync.removedItemIds?.length) {
    update.removedItemIds = [...new Set([...(update.removedItemIds ?? []), ...sync.removedItemIds])];
  }
  if (sync.completed.length > 0) update.questCompletions = sync.completed;
  if (sync.dialogs.length > 0) update.questDialogs = sync.dialogs;

  return update;
}

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
    treePlantedDate: item.treePlantedDate,
    treeFruitCount: item.treeFruitCount,
    fruitLastHarvestedDate: item.fruitLastHarvestedDate,
  };
}

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  return mapToRecord(map);
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
 * Trees may sit on top of any other item — only other trees and soil's inner
 * plantable area block them. Mirrors `canPlaceTree` on the client.
 */
function hasTreeConflict(
  placedItems: IPlacedItem[],
  itemDefsMap: Record<string, { category?: string }>,
  col: number,
  row: number,
  cols: number,
  rows: number,
  excludeAnchorId?: string,
): boolean {
  const blocked = new Set<string>();

  for (const item of placedItems) {
    if (item.anchorId) continue;
    if (excludeAnchorId && item.id === excludeAnchorId) continue;
    const category = itemDefsMap[item.itemType]?.category;

    if (category === 'tree') {
      for (let dr = 0; dr < (item.tileRows ?? 1); dr++) {
        for (let dc = 0; dc < (item.tileCols ?? 1); dc++) {
          blocked.add(`${item.col + dc}:${item.row + dr}`);
        }
      }
      continue;
    }

    if (category === 'soil') {
      const innerCols = Math.max(0, item.tileCols - 2 * SOIL_INNER_INSET);
      const innerRows = Math.max(0, item.tileRows - 2 * SOIL_INNER_INSET);
      for (let dr = 0; dr < innerRows; dr++) {
        for (let dc = 0; dc < innerCols; dc++) {
          blocked.add(`${item.col + SOIL_INNER_INSET + dc}:${item.row + SOIL_INNER_INSET + dr}`);
        }
      }
    }
  }

  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      if (blocked.has(`${col + dc}:${row + dr}`)) return true;
    }
  }
  return false;
}

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

/** Trees occupy 2x2 whatever their art size. Mirrors the client's constant. */
const TREE_FOOTPRINT = 2;

/**
 * Fixed 2×2 top-lefts for the 3 starter fruit trees on a level-1 (16×24) farm.
 * Left, right, and bottom-center — keeps the yard open for crops.
 */
const STARTER_TREE_SLOTS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 1, row: 6 },
  { col: 13, row: 6 },
  { col: 7, row: 20 },
];

/** Fixed tree slots that still fit and are unoccupied. */
function resolveStarterTreeSlots(
  placedItems: IPlacedItem[],
  gridCols: number,
  gridRows: number,
): { col: number; row: number }[] {
  return STARTER_TREE_SLOTS.filter(
    (slot) =>
      inBounds(slot.col, slot.row, TREE_FOOTPRINT, TREE_FOOTPRINT, gridCols, gridRows) &&
      !hasCollision(placedItems, slot.col, slot.row, TREE_FOOTPRINT, TREE_FOOTPRINT),
  ).map((slot) => ({ col: slot.col, row: slot.row }));
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

/**
 * Creates placed item tiles for a given definition at a position.
 * @param placementCols - Override for tile footprint (e.g. tree sapling: 2x2 placement, 1x1 image).
 * @param placementRows - Override for tile footprint.
 */

/**
 * Spot for Bramble: centered on the house footprint, immediately in front (south).
 * Falls back to null when there's no house or the footprint is out of bounds.
 */
function starterNpcInFrontOfHouse(
  placed: IPlacedItem[],
  npcCols: number,
  npcRows: number,
  gridCols: number,
  gridRows: number,
): { col: number; row: number } | null {
  const house = placed.find((i) => i.itemType === 'house' && !i.anchorId);
  if (!house) return null;
  const houseCols = house.tileCols ?? 6;
  const houseRows = house.tileRows ?? HOUSE_PLACE_ROWS;
  const col = house.col + Math.floor((houseCols - npcCols) / 2);
  const row = house.row + houseRows;
  if (!inBounds(col, row, npcCols, npcRows, gridCols, gridRows)) return null;
  if (hasCollision(placed, col, row, npcCols, npcRows)) return null;
  return { col, row };
}

function createPlacedTiles(
  def: IGameItemDef,
  col: number,
  row: number,
  placementCols?: number,
  placementRows?: number,
): IPlacedItem[] {
  const anchorId = genId();
  const isCrop = !!def.growthMs;
  const cols = placementCols ?? def.cols;
  const rows = placementRows ?? def.rows;
  const items: IPlacedItem[] = [];
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const isAnchor = dr === 0 && dc === 0;
      items.push({
        id: isAnchor ? anchorId : genId(),
        itemType: def.itemType,
        col: col + dc,
        row: row + dr,
        tileCols: cols,
        tileRows: rows,
        anchorId: isAnchor ? undefined : anchorId,
        plantedAt: undefined,
        growthMs: isCrop ? def.growthMs : undefined,
        watered: isCrop ? false : undefined,
      });
    }
  }
  return items;
}

async function ensureHouseItemDef(): Promise<void> {
  await GameItemDef.updateOne(
    {
      itemType: 'house',
      $or: [{ rows: { $ne: HOUSE_PLACE_ROWS } }, { centerOverflow: { $ne: true } }],
    },
    { $set: { rows: HOUSE_PLACE_ROWS, centerOverflow: true } },
  );
}

function shiftPlacedItemRows(placed: IPlacedItem[], itemType: string, dy: number): void {
  if (dy === 0) return;
  for (const item of placed) {
    if (item.itemType === itemType) item.row += dy;
  }
}

/** Drop extra house tiles so the pad is 2 rows; art overflows the rest. */
function shrinkHouseToPlaceRows(farm: IFarm): boolean {
  const anchors = farm.placedItems.filter((i) => i.itemType === 'house' && !i.anchorId);
  let changed = false;
  for (const anchor of anchors) {
    const oldRows = anchor.tileRows ?? 5;
    if (oldRows <= HOUSE_PLACE_ROWS) continue;
    const maxRow = anchor.row + HOUSE_PLACE_ROWS;
    farm.placedItems = farm.placedItems.filter((i) => {
      const inThis = i.itemType === 'house' && (i.id === anchor.id || i.anchorId === anchor.id);
      if (!inThis) return true;
      return i.row < maxRow;
    });
    for (const i of farm.placedItems) {
      if (i.itemType === 'house' && (i.id === anchor.id || i.anchorId === anchor.id)) {
        i.tileRows = HOUSE_PLACE_ROWS;
      }
    }
    changed = true;
  }
  return changed;
}

/** Move sell/mail to row 0 when they are still on the old centered default (row 1). */
function pinStarterBoxesToTopRow(farm: IFarm): boolean {
  let changed = false;
  for (const type of STARTER_BOX_TYPES) {
    const anchor = farm.placedItems.find((i) => i.itemType === type && !i.anchorId);
    if (!anchor || anchor.row === STARTER_YARD_TOP_ROW) continue;
    if (anchor.row !== 1) continue;
    shiftPlacedItemRows(farm.placedItems, type, STARTER_YARD_TOP_ROW - anchor.row);
    changed = true;
  }
  return changed;
}

/** Keep Bramble immediately in front of the house after the footprint shrinks. */
function snapStarterNpcAfterHouseShrink(farm: IFarm): boolean {
  const house = farm.placedItems.find((i) => i.itemType === 'house' && !i.anchorId);
  const npc = farm.placedItems.find((i) => i.itemType === STARTER_NPC_ITEM_TYPE && !i.anchorId);
  if (!house || !npc) return false;
  const houseCols = house.tileCols ?? 6;
  const houseRows = house.tileRows ?? HOUSE_PLACE_ROWS;
  const npcCols = npc.tileCols ?? 1;
  const expectedCol = house.col + Math.floor((houseCols - npcCols) / 2);
  if (npc.col !== expectedCol) return false;
  const desiredRow = house.row + houseRows;
  if (npc.row === desiredRow) return false;
  shiftPlacedItemRows(farm.placedItems, STARTER_NPC_ITEM_TYPE, desiredRow - npc.row);
  return true;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const farmService = {
  /**
   * Loads the user's farm, creating one with starter inventory if it doesn't exist.
   */
  async loadOrCreateFarm(userId: string): Promise<IFarm> {
    await ensureHouseItemDef();
    let farm = await Farm.findOne({ userId });
    if (!farm) {
      // Resolve dynamic grid dimensions (scene or level defaults) for new farm
      const { gridCols, gridRows } = await resolveGridDimensions({ farmLevel: 1 });
      const [houseDef, sellBoxDef, mailBoxDef] = await Promise.all([
        GameItemDef.findOne({ itemType: 'house' }).lean(),
        GameItemDef.findOne({ itemType: 'sell_box' }).lean(),
        GameItemDef.findOne({ itemType: 'mail_box' }).lean(),
      ]);
      const starterPlaced: IPlacedItem[] = [];
      if (houseDef) {
        const houseCol = Math.floor((gridCols - houseDef.cols) / 2);
        const houseRow = 0;
        starterPlaced.push(...createPlacedTiles(houseDef, houseCol, houseRow));
        if (sellBoxDef) {
          const sellBoxCol = houseCol + houseDef.cols;
          const sellBoxRow = STARTER_YARD_TOP_ROW;
          if (!hasCollision(starterPlaced, sellBoxCol, sellBoxRow, sellBoxDef.cols, sellBoxDef.rows)) {
            starterPlaced.push(...createPlacedTiles(sellBoxDef, sellBoxCol, sellBoxRow));
          }
        }
        if (mailBoxDef) {
          const mailBoxCol = houseCol + houseDef.cols + (sellBoxDef?.cols ?? 2);
          const mailBoxRow = STARTER_YARD_TOP_ROW;
          if (!hasCollision(starterPlaced, mailBoxCol, mailBoxRow, mailBoxDef.cols, mailBoxDef.rows)) {
            starterPlaced.push(...createPlacedTiles(mailBoxDef, mailBoxCol, mailBoxRow));
          }
        }
      }
      // Starter questline NPC (Bramble) — fixed, centered directly in front of the house.
      const npcDef = await GameItemDef.findOne({
        itemType: STARTER_NPC_ITEM_TYPE,
        category: 'npc',
      }).lean();
      if (npcDef) {
        const spot = starterNpcInFrontOfHouse(
          starterPlaced,
          npcDef.cols,
          npcDef.rows,
          gridCols,
          gridRows,
        );
        if (spot) {
          starterPlaced.push(...createPlacedTiles(npcDef, spot.col, spot.row));
        } else {
          log.warn({ userId }, 'No free spot for starter NPC in front of house');
        }
      }

      const treePlantedDateFullyGrown = getDaysAgoDateStr(3); // So advanceTreeGrowth won't regress next day
      const treeSlots = resolveStarterTreeSlots(starterPlaced, gridCols, gridRows).slice(0, 3);
      const fruitDefs = await GameItemDef.find({ subCategory: 'fruit' }).lean();
      const fullyGrownFruitTrees = await GameItemDef.find({
        category: 'tree',
        itemType: /^tree_fully_grown_/,
        treeFruit: { $exists: true, $ne: '' },
        imageUrl: { $exists: true, $nin: [null, ''] },
      }).lean();
      const fruitToFullyGrown = new Map<string, string[]>();
      for (const fg of fullyGrownFruitTrees) {
        if (!fg.treeFruit) continue;
        const arr = fruitToFullyGrown.get(fg.treeFruit) ?? [];
        if (!arr.includes(fg.itemType)) arr.push(fg.itemType);
        fruitToFullyGrown.set(fg.treeFruit, arr);
      }
      const eligibleFruits = fruitDefs
        .map((f) => f.itemType)
        .filter((ft) => fruitToFullyGrown.has(ft));

      // 3 fully grown fruit trees, fruit type rolled independently, each with 3 fruit.
      if (eligibleFruits.length > 0) {
        for (const slot of treeSlots) {
          const fruit = eligibleFruits[Math.floor(Math.random() * eligibleFruits.length)];
          const options = fruitToFullyGrown.get(fruit) ?? [];
          const fruitTreeType = options[Math.floor(Math.random() * options.length)];
          if (!fruitTreeType) continue;
          starterPlaced.push(
            ...createTreeTiles(fruitTreeType, slot.col, slot.row, treePlantedDateFullyGrown, 3),
          );
        }
      }
      // Day-0 stones & sticks (same counts as daily login).
      const withPickups = await buildPlacedItemsWithDailyGroundPickups(
        starterPlaced,
        gridCols,
        gridRows,
      );
      starterPlaced.splice(0, starterPlaced.length, ...withPickups.items);

      // Day-0 dig spots — same count as daily login. Seeded here so farm reset
      // and brand-new farms have them even before the client hits daily-login.
      const withFossils = await appendFossilHoles(starterPlaced, gridCols, gridRows);
      starterPlaced.splice(0, starterPlaced.length, ...withFossils.items);

      farm = await Farm.create({
        userId,
        inventory: new Map(Object.entries(STARTER_INVENTORY)),
        placedItems: starterPlaced,
      });
      log.info({ userId }, 'Created new farm with house');
      await ensureStarterCraftingRecipes(userId);
      await syncCraftingRecipesThroughLevel(userId, await getUserSkillLevel(userId, 'crafting'));
      await syncCookingRecipesThroughLevel(userId, await getUserSkillLevel(userId, 'cooking'));
      await syncFarmingSoilThroughLevel(userId, await getUserSkillLevel(userId, 'farming'));
    } else {
      // Backfill starter recipes for farms created before stick-tool defaults existed.
      await ensureStarterCraftingRecipes(userId);
      // Catch-up: grant any crafting-level recipes the player already qualifies for.
      await syncCraftingRecipesThroughLevel(userId, await getUserSkillLevel(userId, 'crafting'));
      // Catch-up: cooking-level recipes (every 2 levels).
      await syncCookingRecipesThroughLevel(userId, await getUserSkillLevel(userId, 'cooking'));
      // Catch-up: farming soil milestones (idempotent via farm watermark).
      await syncFarmingSoilThroughLevel(userId, await getUserSkillLevel(userId, 'farming'));

      // Repair farms corrupted by ground-pickup clear (Mongoose length=0 left dups).
      const deduped = dedupePlacedItemsById(farm.placedItems);
      if (deduped.removed > 0) {
        farm.placedItems = deduped.items;
        farm.markModified('placedItems');
        await farm.save();
        log.warn({ userId, removed: deduped.removed }, 'Removed duplicate placedItems by id');
      }

      // Backfill: fully grown fruit trees that have never been harvested should show 3 fruit
      const itemDefsMap = await loadItemDefsMap();
      let fruitBackfill = false;
      for (const item of farm.placedItems) {
        if (item.anchorId) continue;
        const def = itemDefsMap[item.itemType];
        if (
          def?.category === 'tree' &&
          item.itemType.startsWith('tree_fully_grown_') &&
          def.treeFruit &&
          !item.fruitLastHarvestedDate &&
          (item.treeFruitCount ?? 0) < 3
        ) {
          (item as IPlacedItem & { treeFruitCount?: number }).treeFruitCount = 3;
          fruitBackfill = true;
        }
      }
      if (fruitBackfill) {
        farm.markModified('placedItems');
        await farm.save();
      }

      // Backfill: give existing farms a house if they don't have one
      const hasHouse = farm.placedItems.some((i) => i.itemType === 'house');
      const hasHouseInv = (farm.inventory.get('house') ?? 0) > 0;
      if (!hasHouse && !hasHouseInv) {
        const houseDef = await GameItemDef.findOne({ itemType: 'house' }).lean();
        if (houseDef) {
          const { gridCols } = await resolveGridDimensions(farm);
          const houseCol = Math.floor((gridCols - houseDef.cols) / 2);
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

      const shrunkHouse = shrinkHouseToPlaceRows(farm);
      const pinnedBoxes = pinStarterBoxesToTopRow(farm);
      const snappedNpc = snapStarterNpcAfterHouseShrink(farm);
      if (shrunkHouse || pinnedBoxes || snappedNpc) {
        farm.markModified('placedItems');
        await farm.save();
        log.info({ userId }, 'Backfilled house footprint and top-row starter boxes');
      }

      // Backfill starter NPC after farm reset / older farms that never had him.
      // Once his last quest is done he leaves — don't put him back, and send
      // him away if he is still sitting on a finished farm.
      const hasStarterNpc = farm.placedItems.some((i) => i.itemType === STARTER_NPC_ITEM_TYPE);
      const npcDeparted = await UserQuest.exists({
        userId,
        questId: STARTER_NPC_DEPARTURE_QUEST_ID,
        status: 'completed',
      });
      if (npcDeparted) {
        if (hasStarterNpc) {
          const gone = farm.placedItems.filter((i) => i.itemType === STARTER_NPC_ITEM_TYPE).map((i) => i.id);
          const goneSet = new Set(gone);
          farm.placedItems = farm.placedItems.filter((i) => !goneSet.has(i.id));
          farm.markModified('placedItems');
          await farm.save();
          log.info({ userId, removed: gone.length }, 'Removed starter NPC after questline');
        }
      } else if (!hasStarterNpc) {
        const npcDef = await GameItemDef.findOne({
          itemType: STARTER_NPC_ITEM_TYPE,
          category: 'npc',
        }).lean();
        if (npcDef) {
          const { gridCols, gridRows } = await resolveGridDimensions(farm);
          const spot = starterNpcInFrontOfHouse(
            farm.placedItems,
            npcDef.cols,
            npcDef.rows,
            gridCols,
            gridRows,
          );
          if (spot) {
            farm.placedItems.push(...createPlacedTiles(npcDef, spot.col, spot.row));
            farm.markModified('placedItems');
            await farm.save();
            log.info({ userId, ...spot }, 'Backfilled starter NPC in front of house');
          } else {
            log.warn({ userId }, 'No free spot to backfill starter NPC in front of house');
          }
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
    const level = farmLevelOf(farm);

    const { gridCols, gridRows } = await resolveGridDimensions(farm);

    const sceneSlug = `farm_${level.cols}x${level.rows}`;

    const [sceneryRecord, questSync, scene] = await Promise.all([
      BakedScenery.findOne({ farmCols: gridCols, farmRows: gridRows }).lean(),
      questService.sync(userId),
      Scene.findOne({ slug: sceneSlug }).select('cols rows bakedImageUrl placements').lean(),
    ]);

    let sceneryUrl = sceneryRecord?.imageUrl;
    let sceneWorldCols: number | undefined;
    let sceneWorldRows: number | undefined;
    let scenePlacements: ScenePlacementSnapshot[] | undefined;

    if (scene?.bakedImageUrl) {
      sceneryUrl = scene.bakedImageUrl;
      sceneWorldCols = scene.cols;
      sceneWorldRows = scene.rows;
      scenePlacements = scene.placements?.length ? scene.placements.map((p) => ({
        id: p.id,
        itemType: p.itemType,
        x: p.x,
        y: p.y,
        scale: p.scale ?? 1,
        scaleX: p.scaleX,
        scaleY: p.scaleY,
        depthOffset: p.depthOffset,
        rotationDegrees: p.rotationDegrees,
        flipX: p.flipX,
        flipY: p.flipY,
        live: p.live,
      })) : undefined;
      log.info({ userId, sceneSlug, sceneWorldCols, sceneWorldRows, placementCount: scenePlacements?.length ?? 0 }, 'Snapshot: using scene baked scenery');
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

    const backpackSlots = await syncBackpackSlotsFromCrafting(userId, farm);
    const mining = await syncMiningEnergy(userId, farm);
    if (farm.isModified('backpackSlots') || farm.isModified('miningEnergy') || farm.isModified('miningEnergyAt')) {
      await farm.save();
    }

    return {
      farmName: farm.name,
      // A quest can finish during the sync above, so prefer its fresher numbers.
      farmXp: questSync.farmXp ?? farm.xp,
      gems: questSync.gems ?? farm.gems,
      farmLevel: questSync.farmLevel,
      farmLevels: FARM_LEVELS,
      inventory: questSync.inventory ?? inventoryToRecord(farm.inventory),
      storage: inventoryToRecord(farm.storage ?? new Map()),
      backpackSlots,
      ...miningEnergyStateUpdate(mining),
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
      scenePlacements,
      quests: questSync.quests,
      canUpgrade: questSync.canUpgrade,
      questDialogs: questSync.dialogs.length > 0 ? questSync.dialogs : undefined,
      weather: weatherService.getActiveWeather(),
    };
  },

  /**
   * Returns grid dimensions for the user's farm (uses scene when available).
   */
  async getGridDimensions(userId: string): Promise<{ gridCols: number; gridRows: number }> {
    const farm = await this.loadOrCreateFarm(userId);
    return resolveGridDimensions(farm);
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
    const level = farmLevelOf(farm);
    const { gridCols, gridRows } = await resolveGridDimensions(farm);
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

    const { gridCols, gridRows } = await resolveGridDimensions(farm);
    const qty = farm.inventory.get(itemType) ?? 0;
    if (qty <= 0) throw new Error(`No ${itemType} in inventory`);

    const isSeed = def.category === 'seed';
    const isSoil = def.category === 'soil';
    const isTree = def.category === 'tree';
    // A tree occupies 2x2 however big its art is. Checking bounds against the
    // art size rejected edge placements the client had already accepted, which
    // left the client holding an item the server never placed.
    const footCols = isTree ? TREE_FOOTPRINT : def.cols;
    const footRows = isTree ? TREE_FOOTPRINT : def.rows;
    if (!inBounds(col, row, footCols, footRows, gridCols, gridRows)) {
      throw new Error('Placement out of bounds');
    }

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

    if (isTree) {
      const itemDefsMap = await loadItemDefsMap();
      if (hasTreeConflict(farm.placedItems, itemDefsMap, col, row, footCols, footRows)) {
        throw new Error("Trees can't be placed on another tree or on planting soil");
      }
    }

    const currentLvl = farmLevelOf(farm);
    const newItems = isTree
      ? createPlacedTiles(def, col, row, TREE_FOOTPRINT, TREE_FOOTPRINT)
      : createPlacedTiles(def, col, row);
    if (isTree) {
      const today = getTodayDateStr();
      const isFullyGrown = itemType.startsWith('tree_fully_grown_');
      const isFullyGrownFruitTree = isFullyGrown && (def as IGameItemDef).treeFruit;
      // Fully grown trees: use (today - 3) so advanceTreeGrowth won't regress them next day
      const treePlantedDate = isFullyGrown ? getDaysAgoDateStr(3) : today;
      for (const item of newItems) {
        (item as IPlacedItem & { treePlantedDate?: string }).treePlantedDate = treePlantedDate;
        if (isFullyGrownFruitTree && !item.anchorId) {
          (item as IPlacedItem & { treeFruitCount?: number }).treeFruitCount = 3;
        }
      }
    }
    farm.placedItems.push(...newItems);
    farm.inventory.set(itemType, qty - 1);
    awardXp(farm, FARM_XP_REWARDS.place);
    farm.markModified('inventory');
    farm.markModified('placedItems');
    await farm.save();

    log.info({ userId, itemType, col, row }, 'Item placed');

    const skillGrant =
      def.category === 'seed' || def.category === 'soil'
        ? await skillXpService.grant(userId, 'farming', SKILL_XP_REWARDS.farm_place)
        : null;

    // Raise pet mood when planting crops or placing decorations
    let pet: PublicPet | undefined;
    if (def.category === 'seed' || def.category === 'decoration') {
      const updated = await petService.raiseMoodFromFarmAction(userId, 2);
      if (updated) pet = updated;
    }

    const sync = await questService.recordEvents(userId, { kind: 'action', action: 'place', itemType });

    return attachSkillXp(
      withQuestSync({
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        addedItems: newItems.map(toPlacedSnapshot),
        ...(pet && { pet }),
      }, sync),
      skillGrant,
    );
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

    const def = await GameItemDef.findOne({ itemType: target.itemType }).lean();
    if (def?.category === 'npc') throw new Error("NPCs can't be stored");

    if (!opts?.consume) {
      await syncBackpackSlotsFromCrafting(userId, farm);
      if (!canFitInBackpack(farm, target.itemType)) {
        const max = getBackpackSlots(farm);
        throw new Error(`Backpack full (${max}/${max} slots). Store items first.`);
      }
    }

    const removeIds = new Set(toRemove.map((i) => i.id));
    farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

    if (!opts?.consume) {
      addToBackpack(farm, target.itemType, 1);
      awardXp(farm, FARM_XP_REWARDS.remove);
    }
    farm.markModified('placedItems');
    await farm.save();

    const skillGrant = !opts?.consume
      ? await skillXpService.grant(userId, 'farming', SKILL_XP_REWARDS.farm_remove)
      : null;

    log.info({ userId, itemId, itemType: target.itemType, consume: opts?.consume }, 'Item removed');

    // Consuming an item (the pet eating) isn't the player removing something.
    const sync = opts?.consume
      ? await questService.sync(userId)
      : await questService.recordEvents(userId, { kind: 'action', action: 'remove', itemType: target.itemType });

    return attachSkillXp(
      withQuestSync({
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        removedItemIds: [...removeIds],
        backpackSlots: getBackpackSlots(farm),
      }, sync),
      skillGrant,
    );
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

    const farmingLevel = await getUserSkillLevel(userId, 'farming');
    const extraYield = grantCropHarvestLoot(farm, target.itemType, def.harvestYield, farmingLevel);

    awardXp(farm, FARM_XP_REWARDS.harvest);
    farm.markModified('inventory');
    farm.markModified('placedItems');
    await farm.save();

    const skillGrant = await skillXpService.grant(userId, 'farming', SKILL_XP_REWARDS.farm_harvest);

    log.info({ userId, itemId, itemType: target.itemType, yields: extraYield }, 'Crop harvested');

    // A harvest counts for the crop that was planted and for everything it yielded,
    // so authors can ask for either "harvest wheat_seed" or "harvest wheat".
    const harvested = new Set<string>([target.itemType, ...extraYield]);
    const sync = await questService.recordEvents(
      userId,
      ...[...harvested].map((itemType) => ({ kind: 'action' as const, action: 'harvest', itemType })),
      { kind: 'crop_grown', itemType: target.itemType },
    );

    return attachSkillXp(
      withQuestSync({
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        storage: inventoryToRecord(farm.storage ?? new Map()),
        removedItemIds: [...removeIds],
      }, sync),
      skillGrant,
    );
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
    if (def.category === 'npc') throw new Error("NPCs can't be moved");

    const { gridCols, gridRows } = await resolveGridDimensions(farm);
    if (!inBounds(newCol, newRow, def.cols, def.rows, gridCols, gridRows)) throw new Error('Move destination out of bounds');

    const anchorItem = farm.placedItems.find((i) => i.id === anchId) ?? target;

    const oldIds = farm.placedItems
      .filter((i) => i.id === anchId || i.anchorId === anchId)
      .map((i) => i.id);
    farm.placedItems = farm.placedItems.filter((i) => !oldIds.includes(i.id));

    const isTree = def.category === 'tree';
    const moveCols = isTree ? (anchorItem.tileCols ?? 2) : def.cols;
    const moveRows = isTree ? (anchorItem.tileRows ?? 2) : def.rows;
    if (!inBounds(newCol, newRow, moveCols, moveRows, gridCols, gridRows)) {
      throw new Error('Move destination out of bounds');
    }
    // Items are free to overlap; only trees and soil have placement rules.
    if (isTree) {
      const itemDefsMap = await loadItemDefsMap();
      if (hasTreeConflict(farm.placedItems, itemDefsMap, newCol, newRow, moveCols, moveRows, anchId)) {
        throw new Error("Trees can't be placed on another tree or on planting soil");
      }
    }

    if (def.category === 'soil') {
      const itemDefsMap = await loadItemDefsMap();
      if (hasSoilOverlap(farm.placedItems, itemDefsMap, newCol, newRow, def.cols, def.rows)) {
        throw new Error('Soil cannot be placed on top of the plantable area of another soil patch');
      }
    }

    const newItems: IPlacedItem[] = [];
    for (let dr = 0; dr < moveRows; dr++) {
      for (let dc = 0; dc < moveCols; dc++) {
        const isAnchor = dr === 0 && dc === 0;
        const item: IPlacedItem = {
          id: isAnchor ? anchId : genId(),
          itemType: target.itemType,
          col: newCol + dc,
          row: newRow + dr,
          tileCols: moveCols,
          tileRows: moveRows,
          anchorId: isAnchor ? undefined : anchId,
          plantedAt: anchorItem.plantedAt,
          growthMs: anchorItem.growthMs,
          watered: anchorItem.watered,
        };
        if (isTree) {
          item.treePlantedDate = anchorItem.treePlantedDate;
          if (isAnchor) {
            item.treeFruitCount = anchorItem.treeFruitCount;
            item.fruitLastHarvestedDate = anchorItem.fruitLastHarvestedDate;
          }
        }
        newItems.push(item);
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

    const skillGrant = await skillXpService.grant(userId, 'farming', SKILL_XP_REWARDS.farm_water);

    const wateredTiles = farm.placedItems.filter(
      (i) => i.id === anchId || i.anchorId === anchId,
    );

    log.info({ userId, col, row, itemType: target.itemType }, 'Tile watered');

    const sync = await questService.recordEvents(userId, { kind: 'action', action: 'water', itemType: target.itemType });

    return attachSkillXp(
      withQuestSync({
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        addedItems: wateredTiles.map(toPlacedSnapshot),
        removedItemIds: wateredTiles.map((i) => i.id),
      }, sync),
      skillGrant,
    );
  },

  /**
   * Purchases an item from the shop using gems.
   * Server is the failsafe: buyable, price, stock window, and level gates
   * are all re-checked here regardless of what the client shows.
   */
  async purchaseItem(userId: string, itemType: string): Promise<StateUpdate> {
    const def = await GameItemDef.findOne({ itemType }).lean();
    if (!def) throw new Error(`Unknown item type: ${itemType}`);
    if (!def.buyable) throw new Error('This item is not for sale');
    const isRecipeScroll =
      def.subCategory === 'crafting_recipe' || def.subCategory === 'cooking_recipe';
    if (def.category === 'material' && !isRecipeScroll) throw new Error('This item is not for sale');
    if (!def.gemPrice || def.gemPrice <= 0) throw new Error('Item has no price set');
    if (def.availableUntil && new Date(def.availableUntil).getTime() <= Date.now()) {
      throw new Error('This item is no longer available');
    }

    const farm = await this.loadOrCreateFarm(userId);
    const farmLvl = farm.farmLevel ?? 1;
    const requiredFarm = def.farmLevel ?? 0;
    if (requiredFarm > 0 && farmLvl < requiredFarm) {
      throw new Error(`Requires farm level ${requiredFarm}`);
    }

    const requiredPet = def.petLevel ?? 0;
    const requiredFarming = def.farmingSkillLevel ?? 0;
    if (requiredPet > 0 || requiredFarming > 0) {
      const user = await User.findById(userId).select('pet.level skills.farming.level').lean();
      if (requiredPet > 0) {
        const petLvl = user?.pet?.level ?? 0;
        if (petLvl < requiredPet) {
          throw new Error(`Requires pet level ${requiredPet}`);
        }
      }
      if (requiredFarming > 0) {
        const farmingLvl = user?.skills?.farming?.level ?? 0;
        if (farmingLvl < requiredFarming) {
          throw new Error(`Requires farming skill level ${requiredFarming}`);
        }
      }
    }

    const currency = typeof def.shopCurrency === 'string' ? def.shopCurrency.trim() : '';
    if (currency) {
      const currencyDef = await GameItemDef.findOne({ itemType: currency }).lean();
      const label = currencyDef?.label ?? currency;
      const have = farm.inventory.get(currency) ?? 0;
      if (have < def.gemPrice) throw new Error(`Not enough ${label}`);
      takeFromBackpack(farm, currency, def.gemPrice);
    } else {
      if (farm.gems < def.gemPrice) throw new Error('Not enough gems');
      farm.gems -= def.gemPrice;
    }
    addToBackpack(farm, itemType, 1);
    await farm.save();

    log.info(
      { userId, itemType, cost: def.gemPrice, currency: currency || 'gems', remaining: farm.gems },
      'Item purchased',
    );

    const sync = await questService.recordEvents(userId, { kind: 'action', action: 'purchase', itemType });

    return withQuestSync({
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
    }, sync);
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

    const sync = await questService.recordEvents(userId, { kind: 'action', action: 'sell', itemType, count: sellQty });

    return withQuestSync({
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
    }, sync);
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
    const sold: QuestEvent[] = [];

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
      sold.push({ kind: 'action', action: 'sell', itemType, count: sellQty });
    }

    farm.gems += totalGems;
    farm.markModified('inventory');
    await farm.save();

    log.info({ userId, itemCount: items.length, totalGems }, 'Items sold (batch)');

    const sync = await questService.recordEvents(userId, ...sold);

    return withQuestSync({
      gems: farm.gems,
      inventory: inventoryToRecord(farm.inventory),
    }, sync);
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
    const level = farmLevelOf(farm);
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
    const farmingLevel = await getUserSkillLevel(userId, 'farming');
    const { gridCols, gridRows } = await resolveGridDimensions(farm);
    const failedOps: number[] = [];
    const allAdded: IPlacedItem[] = [];
    const allRemovedIds: string[] = [];
    const trackActions: { action: string; itemType: string }[] = [];
    let totalXp = 0;
    let skillFarmXp = 0;

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
          skillFarmXp += SKILL_XP_REWARDS.farm_place;
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
          skillFarmXp += SKILL_XP_REWARDS.farm_water;
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

          const extraYield = grantCropHarvestLoot(farm, target.itemType, def.harvestYield, farmingLevel);

          totalXp += FARM_XP_REWARDS.harvest;
          skillFarmXp += SKILL_XP_REWARDS.farm_harvest;
          trackActions.push({ action: 'harvest', itemType: target.itemType });
          for (const itemType of extraYield) {
            if (itemType !== target.itemType) {
              trackActions.push({ action: 'harvest', itemType });
            }
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

    const skillGrant =
      skillFarmXp > 0 ? await skillXpService.grant(userId, 'farming', skillFarmXp) : null;

    log.info({ userId, opCount: ops.length, failed: failedOps.length }, 'Crop batch processed');

    // Roll the batch up into one event per action+item pair. These used to be
    // fired in parallel, and concurrent saves of the same quest row lost counts.
    const actionCounts = new Map<string, Map<string, number>>();
    for (const ta of trackActions) {
      if (!actionCounts.has(ta.action)) actionCounts.set(ta.action, new Map());
      const itemMap = actionCounts.get(ta.action)!;
      itemMap.set(ta.itemType, (itemMap.get(ta.itemType) ?? 0) + 1);
    }

    const events: QuestEvent[] = [];
    for (const [action, itemMap] of actionCounts) {
      for (const [itemType, count] of itemMap) {
        events.push({ kind: 'action', action, itemType, count });
        if (action === 'harvest') events.push({ kind: 'crop_grown', itemType, count });
      }
    }

    const sync = await questService.recordEvents(userId, ...events);

    // Build the watered items list for addedItems (deduplicated by ID)
    const wateredAddedMap = new Map<string, IPlacedItem>();
    const wateredRemovedIdSet = new Set<string>();
    for (const op of ops) {
      if (op.type !== 'water') continue;
      const directHit = farm.placedItems.find(
        (d) => d.col === op.col && d.row === op.row && !!d.growthMs,
      );
      if (!directHit) continue;

      const aId = directHit.anchorId ?? directHit.id;
      const siblings = farm.placedItems.filter(
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

    return attachSkillXp(
      withQuestSync(
        {
          farmXp: farm.xp,
          gems: farm.gems,
          inventory: inventoryToRecord(farm.inventory),
          addedItems: Array.from(addedMap.values()),
          removedItemIds: Array.from(finalRemovedIds),
          ...(pet && { pet }),
          ...(failedOps.length > 0 && { failedOps }),
        },
        sync,
      ) as StateUpdate & { failedOps?: number[] },
      skillGrant,
    );
  },

  /**
   * Move items from backpack → farm storage (uncapped vault).
   */
  async depositToStorage(
    userId: string,
    items: Array<{ itemType: string; qty: number }>,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);
    for (const { itemType, qty } of items) {
      if (!itemType || qty <= 0) continue;
      takeFromBackpack(farm, itemType, qty);
      addToStorage(farm, itemType, qty);
    }
    const backpackSlots = await syncBackpackSlotsFromCrafting(userId, farm);
    await farm.save();
    log.info({ userId, items }, 'Deposited to storage');
    return {
      inventory: inventoryToRecord(farm.inventory),
      storage: inventoryToRecord(farm.storage ?? new Map()),
      backpackSlots,
    };
  },

  /**
   * Move items from storage → backpack (respects backpack slot cap).
   */
  async withdrawFromStorage(
    userId: string,
    items: Array<{ itemType: string; qty: number }>,
  ): Promise<StateUpdate> {
    const farm = await this.loadOrCreateFarm(userId);
    const backpackSlots = await syncBackpackSlotsFromCrafting(userId, farm);
    for (const { itemType, qty } of items) {
      if (!itemType || qty <= 0) continue;
      takeFromStorage(farm, itemType, qty);
      try {
        addToBackpack(farm, itemType, qty);
      } catch (err) {
        // Roll back this item's storage take by putting it back.
        addToStorage(farm, itemType, qty);
        throw err;
      }
    }
    await farm.save();
    log.info({ userId, items }, 'Withdrew from storage');
    return {
      inventory: inventoryToRecord(farm.inventory),
      storage: inventoryToRecord(farm.storage ?? new Map()),
      backpackSlots,
    };
  },

  farmLevelOf,
  farmLevelByNumber,
};
