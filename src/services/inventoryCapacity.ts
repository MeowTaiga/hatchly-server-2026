/**
 * Backpack slot capacity helpers.
 * A "slot" is one itemType stack with qty > 0. Stacking more of the same type
 * never consumes an extra slot. Storage (farm.storage) is uncapped.
 *
 * Capacity scales with crafting skill milestones (see skillPerks).
 */

import { backpackSlotsFromCraftingLevel } from '../constants/skillPerks.js';

export const BASE_BACKPACK_SLOTS = 20;

export function inventorySlotCount(inv: Map<string, number> | Record<string, number>): number {
  if (inv instanceof Map) {
    let n = 0;
    for (const qty of inv.values()) if (qty > 0) n += 1;
    return n;
  }
  let n = 0;
  for (const qty of Object.values(inv)) if (qty > 0) n += 1;
  return n;
}

/**
 * Effective backpack capacity.
 * Prefer crafting-derived capacity when a crafting level is provided; otherwise
 * fall back to a stored farm.backpackSlots override or the base 20.
 */
export function getBackpackSlots(
  farm: { backpackSlots?: number | null },
  craftingLevel?: number | null,
): number {
  if (typeof craftingLevel === 'number' && craftingLevel >= 0) {
    return backpackSlotsFromCraftingLevel(craftingLevel);
  }
  const n = farm.backpackSlots;
  return typeof n === 'number' && n >= 1 ? n : BASE_BACKPACK_SLOTS;
}

export function mapToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) if (v > 0) out[k] = v;
  return out;
}

function ensureStorageMap(farm: {
  storage?: Map<string, number> | null;
}): Map<string, number> {
  if (!farm.storage) {
    farm.storage = new Map();
  }
  return farm.storage;
}

/** True if adding this itemType would fit without opening a new backpack slot. */
export function canFitInBackpack(
  farm: { inventory: Map<string, number>; backpackSlots?: number | null },
  itemType: string,
  craftingLevel?: number | null,
): boolean {
  const current = farm.inventory.get(itemType) ?? 0;
  if (current > 0) return true;
  return inventorySlotCount(farm.inventory) < getBackpackSlots(farm, craftingLevel);
}

/**
 * Adds to backpack only. Throws when a new stack would exceed capacity.
 */
export function addToBackpack(
  farm: { inventory: Map<string, number>; backpackSlots?: number | null; markModified: (k: string) => void },
  itemType: string,
  qty: number,
  craftingLevel?: number | null,
): void {
  if (qty <= 0) return;
  if (!canFitInBackpack(farm, itemType, craftingLevel)) {
    const max = getBackpackSlots(farm, craftingLevel);
    throw new Error(`Backpack full (${max}/${max} slots). Store items first.`);
  }
  const current = farm.inventory.get(itemType) ?? 0;
  farm.inventory.set(itemType, current + qty);
  farm.markModified('inventory');
}

/** Always succeeds — storage is uncapped. */
export function addToStorage(
  farm: {
    storage?: Map<string, number> | null;
    markModified: (k: string) => void;
  },
  itemType: string,
  qty: number,
): void {
  if (qty <= 0) return;
  const storage = ensureStorageMap(farm);
  storage.set(itemType, (storage.get(itemType) ?? 0) + qty);
  farm.markModified('storage');
}

/**
 * Prefer backpack (existing stack or free slot); overflow remainder to storage.
 * Returns how much went where.
 */
export function grantLoot(
  farm: {
    inventory: Map<string, number>;
    storage?: Map<string, number> | null;
    backpackSlots?: number | null;
    markModified: (k: string) => void;
  },
  itemType: string,
  qty: number,
  craftingLevel?: number | null,
): { backpack: number; storage: number } {
  if (qty <= 0) return { backpack: 0, storage: 0 };
  if (canFitInBackpack(farm, itemType, craftingLevel)) {
    addToBackpack(farm, itemType, qty, craftingLevel);
    return { backpack: qty, storage: 0 };
  }
  addToStorage(farm, itemType, qty);
  return { backpack: 0, storage: qty };
}

export function takeFromBackpack(
  farm: { inventory: Map<string, number>; markModified: (k: string) => void },
  itemType: string,
  qty: number,
): void {
  const have = farm.inventory.get(itemType) ?? 0;
  if (have < qty) throw new Error(`Not enough ${itemType} in backpack`);
  const next = have - qty;
  if (next <= 0) farm.inventory.delete(itemType);
  else farm.inventory.set(itemType, next);
  farm.markModified('inventory');
}

export function takeFromStorage(
  farm: {
    storage?: Map<string, number> | null;
    markModified: (k: string) => void;
  },
  itemType: string,
  qty: number,
): void {
  const storage = ensureStorageMap(farm);
  const have = storage.get(itemType) ?? 0;
  if (have < qty) throw new Error(`Not enough ${itemType} in storage`);
  const next = have - qty;
  if (next <= 0) storage.delete(itemType);
  else storage.set(itemType, next);
  farm.markModified('storage');
}

function qtyOf(
  bag: Map<string, number> | Record<string, number> | undefined | null,
  itemType: string,
): number {
  if (!bag) return 0;
  if (bag instanceof Map) return bag.get(itemType) ?? 0;
  return bag[itemType] ?? 0;
}

/** Backpack + storage count for one item type. */
export function combinedQty(
  backpack: Map<string, number> | Record<string, number> | undefined | null,
  storage: Map<string, number> | Record<string, number> | undefined | null,
  itemType: string,
): number {
  return qtyOf(backpack, itemType) + qtyOf(storage, itemType);
}

/** Spend from backpack first, then storage. */
export function takeFromBackpackThenStorage(
  farm: {
    inventory: Map<string, number>;
    storage?: Map<string, number> | null;
    markModified: (k: string) => void;
  },
  itemType: string,
  qty: number,
): void {
  if (qty <= 0) return;
  const have = combinedQty(farm.inventory, farm.storage, itemType);
  if (have < qty) {
    throw new Error(`Not enough ${itemType} (need ${qty}, have ${have})`);
  }
  const fromBag = Math.min(farm.inventory.get(itemType) ?? 0, qty);
  if (fromBag > 0) takeFromBackpack(farm, itemType, fromBag);
  const rest = qty - fromBag;
  if (rest > 0) takeFromStorage(farm, itemType, rest);
}
