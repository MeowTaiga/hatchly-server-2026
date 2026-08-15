import crypto from 'crypto';
import { type IPlacedItem } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { farmService, withQuestSync, type StateUpdate } from './FarmService.js';
import { questService } from './quests/index.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('GroundPickupService');

/**
 * Daily / day-0 world pickups on the farm (tap to collect).
 * Keep these above the tidy-yard quest counts so extras remain after the quest.
 */
export const DAILY_GROUND_PICKUPS: ReadonlyArray<{ itemType: string; count: number }> = [
  { itemType: 'stone', count: 12 },
  { itemType: 'stick', count: 15 },
];

export const GROUND_PICKUP_ITEM_TYPES = DAILY_GROUND_PICKUPS.map((p) => p.itemType);

export function isGroundPickupItemType(itemType: string | undefined | null): boolean {
  return !!itemType && (GROUND_PICKUP_ITEM_TYPES as readonly string[]).includes(itemType);
}

function genId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}

/**
 * Finds empty grid slots. Prefers interior tiles; falls back to any empty tile.
 * Marks ALL tiles occupied by multi-tile items (not just anchors).
 */
export function findEmptyGridSlots(
  placedItems: IPlacedItem[],
  gridCols: number,
  gridRows: number,
  count: number,
): { col: number; row: number }[] {
  const occupied = new Set<string>();
  for (const item of placedItems) {
    const cols = item.tileCols ?? 1;
    const rows = item.tileRows ?? 1;
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < cols; dc++) {
        occupied.add(`${item.col + dc}:${item.row + dr}`);
      }
    }
  }

  const isEdge = (col: number, row: number) =>
    col === 0 || col === gridCols - 1 || row === 0 || row === gridRows - 1;

  const interior: { col: number; row: number }[] = [];
  const allEmpty: { col: number; row: number }[] = [];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      if (occupied.has(`${col}:${row}`)) continue;
      allEmpty.push({ col, row });
      if (!isEdge(col, row)) interior.push({ col, row });
    }
  }

  const candidates = interior.length >= count ? interior : allEmpty;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

function create1x1Placed(itemType: string, col: number, row: number): IPlacedItem {
  return {
    id: genId(),
    itemType,
    col,
    row,
    tileCols: 1,
    tileRows: 1,
  };
}

/** Returns a copy of placedItems without stone/stick world pickups. */
export function clearGroundPickups(placedItems: readonly IPlacedItem[]): IPlacedItem[] {
  return placedItems.filter((i) => !isGroundPickupItemType(i.itemType));
}

/**
 * Builds a new placedItems list with today's stone/stick pickups.
 * Clears any existing ground pickups first so create + daily login stay idempotent.
 *
 * IMPORTANT: returns a fresh array — callers must assign it (e.g. `farm.placedItems = items`).
 * Never clear a Mongoose DocumentArray with `arr.length = 0` then push(...kept); that
 * fails to clear and duplicates every tile id (React key spam on the client).
 */
export async function buildPlacedItemsWithDailyGroundPickups(
  placedItems: readonly IPlacedItem[],
  gridCols: number,
  gridRows: number,
): Promise<{ items: IPlacedItem[]; placed: number }> {
  const items = clearGroundPickups(placedItems);

  const defs = await GameItemDef.find({
    itemType: { $in: [...GROUND_PICKUP_ITEM_TYPES] },
  }).lean();
  const known = new Set(defs.map((d) => d.itemType));

  let placed = 0;
  for (const { itemType, count } of DAILY_GROUND_PICKUPS) {
    if (!known.has(itemType)) {
      log.warn({ itemType }, 'Ground pickup item def missing, skipping spawn');
      continue;
    }
    const slots = findEmptyGridSlots(items, gridCols, gridRows, count);
    for (const slot of slots) {
      items.push(create1x1Placed(itemType, slot.col, slot.row));
      placed += 1;
    }
  }
  return { items, placed };
}

/** Day-0 / daily dig spots placed on the farm plot. */
export const DAILY_FOSSIL_HOLE_COUNT = 2;
export const FOSSIL_HOLE_ITEM_TYPE = 'fossil_hole';

/**
 * Appends fossil dig holes onto a placedItems list (does not clear existing holes).
 * Used for day-0 farm create and returning daily login grants.
 */
export async function appendFossilHoles(
  placedItems: readonly IPlacedItem[],
  gridCols: number,
  gridRows: number,
  count: number = DAILY_FOSSIL_HOLE_COUNT,
): Promise<{ items: IPlacedItem[]; placed: number }> {
  const fossilDef = await GameItemDef.findOne({ itemType: FOSSIL_HOLE_ITEM_TYPE }).lean();
  if (!fossilDef || !fossilDef.placeable) {
    log.warn('fossil_hole not found or not placeable, skipping dig-spot placement');
    return { items: [...placedItems], placed: 0 };
  }

  const items = [...placedItems];
  const slots = findEmptyGridSlots(items, gridCols, gridRows, count);
  for (const slot of slots) {
    items.push(create1x1Placed(FOSSIL_HOLE_ITEM_TYPE, slot.col, slot.row));
  }
  return { items, placed: slots.length };
}

/** Spawns today's ground pickups on an existing farm (daily login / refresh). */
export async function spawnDailyGroundPickupsForUser(userId: string): Promise<number> {
  const farm = await farmService.loadOrCreateFarm(userId);
  const { gridCols, gridRows } = await farmService.getGridDimensions(userId);
  const { items, placed } = await buildPlacedItemsWithDailyGroundPickups(
    farm.placedItems,
    gridCols,
    gridRows,
  );
  farm.placedItems = items;
  farm.markModified('placedItems');
  await farm.save();
  log.info({ userId, placed }, 'Daily ground pickups spawned');
  return placed;
}

export interface GroundPickupResult {
  anchorId: string;
  itemType: string;
  label: string;
  qty: number;
}

/** Tap-collect a placed stone/stick into inventory. */
export async function pickupGroundItem(
  userId: string,
  anchorId: string,
): Promise<{ result: GroundPickupResult; stateUpdate: StateUpdate }> {
  const farm = await farmService.loadOrCreateFarm(userId);
  const target = farm.placedItems.find((i) => i.id === anchorId || i.anchorId === anchorId);
  if (!target) throw new Error('Nothing to pick up');
  if (!isGroundPickupItemType(target.itemType)) {
    throw new Error('That cannot be picked up');
  }

  const anchId = target.anchorId ?? target.id;
  const toRemove = farm.placedItems.filter((i) => i.id === anchId || i.anchorId === anchId);
  const removeIds = new Set(toRemove.map((i) => i.id));
  farm.placedItems = farm.placedItems.filter((i) => !removeIds.has(i.id));

  const qty = 1;
  const current = farm.inventory.get(target.itemType) ?? 0;
  farm.inventory.set(target.itemType, current + qty);
  farm.markModified('placedItems');
  farm.markModified('inventory');
  await farm.save();

  const def = await GameItemDef.findOne({ itemType: target.itemType }).lean();
  const label = def?.label ?? target.itemType;

  log.info({ userId, anchorId: anchId, itemType: target.itemType }, 'Ground pickup collected');

  const sync = await questService.recordEvents(userId, {
    kind: 'action',
    action: 'pickup_ground',
    itemType: target.itemType,
  });

  return {
    result: { anchorId: anchId, itemType: target.itemType, label, qty },
    stateUpdate: withQuestSync(
      {
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        removedItemIds: [...removeIds],
      },
      sync,
    ),
  };
}
