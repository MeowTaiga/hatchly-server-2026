/**
 * Server-side pet targeting logic. Ported from client targeting.ts.
 * Works with IPlacedItem[] and server item defs.
 */
import type { IPlacedItem } from '../models/Farm.js';
import type { IGameItemDef } from '../models/GameItemDef.js';

const SUB_CATEGORY_PET_BED = 'pet_bed';
const SUB_CATEGORY_FOOD = 'food';
const PET_WALKABLE_SUBCATEGORIES = [SUB_CATEGORY_PET_BED, SUB_CATEGORY_FOOD];

/** Item defs with this interactAction can be stood on by the pet (e.g. food bowl). */
const WALKABLE_INTERACT_PAYLOADS = ['food_dish'] as const;

function tileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function getBlockedTileKeysForPet(
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  walkableSubCategories: readonly string[],
): Set<string> {
  const blocked = new Set<string>();
  for (const item of placedItems) {
    const def = itemDefs[item.itemType];
    const isWalkable =
      (def?.subCategory && walkableSubCategories.includes(def.subCategory)) ||
      (def?.interactAction?.payload && WALKABLE_INTERACT_PAYLOADS.includes(def.interactAction.payload as (typeof WALKABLE_INTERACT_PAYLOADS)[number]));
    if (isWalkable) continue;
    // Child tiles (anchorId set) represent a single cell; only anchors use full tileCols/tileRows
    const isChild = !!item.anchorId;
    const tileCols = isChild ? 1 : (item.tileCols ?? 1);
    const tileRows = isChild ? 1 : (item.tileRows ?? 1);
    for (let dr = 0; dr < tileRows; dr++) {
      for (let dc = 0; dc < tileCols; dc++) {
        blocked.add(tileKey(item.col + dc, item.row + dr));
      }
    }
  }
  return blocked;
}

function getPlacedItemsBySubCategory(
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  subCategory: string,
): IPlacedItem[] {
  return placedItems.filter((item) => {
    const def = itemDefs[item.itemType];
    return def?.subCategory === subCategory;
  });
}

function getItemCenter(item: IPlacedItem): { col: number; row: number } {
  const tileCols = item.tileCols ?? 1;
  const tileRows = item.tileRows ?? 1;
  return {
    col: item.col + Math.floor(tileCols / 2),
    row: item.row + Math.floor(tileRows / 2),
  };
}

function getInteractionDestination(
  item: IPlacedItem,
  itemDefs: Record<string, IGameItemDef>,
  walkableSubCategories: readonly string[],
  blocked: Set<string>,
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  const def = itemDefs[item.itemType];
  const canStandOn =
    (def?.subCategory && walkableSubCategories.includes(def.subCategory)) ||
    (def?.interactAction?.payload && WALKABLE_INTERACT_PAYLOADS.includes(def.interactAction.payload as (typeof WALKABLE_INTERACT_PAYLOADS)[number]));

  if (canStandOn) {
    const center = getItemCenter(item);
    if (
      center.col >= 0 &&
      center.col < cols &&
      center.row >= 0 &&
      center.row < rows &&
      !blocked.has(tileKey(center.col, center.row))
    ) {
      return center;
    }
  }

  const { col: cc, row: cr } = getItemCenter(item);
  const candidates: { col: number; row: number }[] = [
    { col: cc, row: cr + 1 },
    { col: cc, row: cr - 1 },
    { col: cc + 1, row: cr },
    { col: cc - 1, row: cr },
  ];
  for (const t of candidates) {
    if (
      t.col >= 0 &&
      t.col < cols &&
      t.row >= 0 &&
      t.row < rows &&
      !blocked.has(tileKey(t.col, t.row))
    ) {
      return t;
    }
  }
  return null;
}

function getFoodInteractionTile(
  item: IPlacedItem,
  itemDefs: Record<string, IGameItemDef>,
  blocked: Set<string>,
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  const { col: cc, row: cr } = getItemCenter(item);
  const behind = { col: cc, row: cr - 1 };
  if (
    behind.row >= 0 &&
    behind.col >= 0 &&
    behind.col < cols &&
    !blocked.has(tileKey(behind.col, behind.row))
  ) {
    return behind;
  }
  return getInteractionDestination(
    item,
    itemDefs,
    PET_WALKABLE_SUBCATEGORIES,
    blocked,
    cols,
    rows,
  );
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isTileWalkable(
  col: number,
  row: number,
  cols: number,
  rows: number,
  blocked: Set<string>,
): boolean {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
  return !blocked.has(tileKey(col, row));
}

export interface TileCoord {
  col: number;
  row: number;
}

/** Pick a random wander target within radius of current position. */
export function pickRandomTarget(
  cur: TileCoord,
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  cols: number,
  rows: number,
  radius: number,
): TileCoord | null {
  const blocked = getBlockedTileKeysForPet(placedItems, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const minCol = Math.max(0, cur.col - radius);
  const maxCol = Math.min(cols - 1, cur.col + radius);
  const minRow = Math.max(0, cur.row - radius);
  const maxRow = Math.min(rows - 1, cur.row + radius);

  const candidates: TileCoord[] = [];
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      if (isTileWalkable(c, r, cols, rows, blocked) && (c !== cur.col || r !== cur.row)) {
        candidates.push({ col: c, row: r });
      }
    }
  }
  return candidates.length === 0 ? null : candidates[randInt(0, candidates.length - 1)];
}

/** Pick a food item to walk to. Returns tile behind food + item. */
export function pickFoodTarget(
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  cols: number,
  rows: number,
): { tile: TileCoord; item: IPlacedItem } | null {
  let foods = getPlacedItemsBySubCategory(placedItems, itemDefs, SUB_CATEGORY_FOOD);
  if (foods.length === 0) {
    foods = placedItems.filter((item) => {
      const def = itemDefs[item.itemType];
      return def?.category === 'food' && !item.anchorId;
    });
  }
  if (foods.length === 0) return null;

  const blocked = getBlockedTileKeysForPet(placedItems, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const item = foods[randInt(0, foods.length - 1)];
  const tile = getFoodInteractionTile(item, itemDefs, blocked, cols, rows);
  return tile ? { tile, item } : null;
}

/** Pick a food dish with food in its queue. Pet walks there to eat. */
export function pickFoodDishTarget(
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  foodDishQueues: Record<string, string[]> | undefined,
  cols: number,
  rows: number,
): { tile: TileCoord; item: IPlacedItem } | null {
  if (!foodDishQueues || Object.keys(foodDishQueues).length === 0) return null;

  const dishes = placedItems.filter((item) => {
    if (item.anchorId) return false;
    const def = itemDefs[item.itemType];
    const anchorId = item.anchorId ?? item.id;
    return (
      def?.interactAction?.payload === 'food_dish' &&
      (foodDishQueues[anchorId]?.length ?? 0) > 0
    );
  });
  if (dishes.length === 0) return null;

  const blocked = getBlockedTileKeysForPet(placedItems, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const item = dishes[randInt(0, dishes.length - 1)];
  const tile = getFoodInteractionTile(item, itemDefs, blocked, cols, rows);
  return tile ? { tile, item } : null;
}

/** Pick a pet bed to walk to. */
export function pickPetBedTarget(
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  cols: number,
  rows: number,
): { tile: TileCoord; item: IPlacedItem } | null {
  const beds = getPlacedItemsBySubCategory(placedItems, itemDefs, SUB_CATEGORY_PET_BED);
  if (beds.length === 0) return null;

  const blocked = getBlockedTileKeysForPet(placedItems, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const item = beds[randInt(0, beds.length - 1)];
  const tile = getInteractionDestination(
    item,
    itemDefs,
    PET_WALKABLE_SUBCATEGORIES,
    blocked,
    cols,
    rows,
  );
  return tile ? { tile, item } : null;
}

/** Find first walkable tile adjacent to an item (e.g. fossil hole). Used for user-initiated dig. */
export function findAdjacentWalkableForItem(
  item: IPlacedItem,
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  cols: number,
  rows: number,
): TileCoord | null {
  const itemIds = new Set<string>([item.id, ...(item.anchorId ? [item.anchorId] : [])]);
  const others = placedItems.filter((i) => !itemIds.has(i.id) && !itemIds.has(i.anchorId ?? ''));
  const blocked = getBlockedTileKeysForPet(others, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const dest = getInteractionDestination(item, itemDefs, [], blocked, cols, rows);
  if (dest) return dest;
  const { col: cc, row: cr } = getItemCenter(item);
  if (
    cc >= 0 && cc < cols && cr >= 0 && cr < rows &&
    !blocked.has(tileKey(cc, cr))
  ) {
    return { col: cc, row: cr };
  }
  return null;
}

/** Pick an adjacent walkable tile to a bug. Pet will walk there and admire (wow). */
export function pickBugTarget(
  bugs: { col: number; row: number }[],
  placedItems: IPlacedItem[],
  itemDefs: Record<string, IGameItemDef>,
  cols: number,
  rows: number,
): TileCoord | null {
  if (bugs.length === 0) return null;
  const blocked = getBlockedTileKeysForPet(placedItems, itemDefs, PET_WALKABLE_SUBCATEGORIES);
  const shuffled = [...bugs].sort(() => Math.random() - 0.5);
  for (const bug of shuffled) {
    const adj: TileCoord[] = [
      { col: bug.col - 1, row: bug.row },
      { col: bug.col + 1, row: bug.row },
      { col: bug.col, row: bug.row - 1 },
      { col: bug.col, row: bug.row + 1 },
    ];
    const valid = adj.filter((a) => isTileWalkable(a.col, a.row, cols, rows, blocked));
    if (valid.length > 0) return valid[randInt(0, valid.length - 1)];
  }
  return null;
}
