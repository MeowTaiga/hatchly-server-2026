/**
 * Grants soil into inventory/storage from farming skill milestones.
 * Uses a Farm watermark so catch-up and level-ups stay idempotent.
 */

import { Farm } from '../models/Farm.js';
import {
  FARMING_SOIL_ITEM_TYPE,
  soilQtyUnlockedBetween,
} from '../constants/farmingLevelSoilGrants.js';
import { grantLoot, mapToRecord } from './inventoryCapacity.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('FarmingLevelSoilGrants');

export interface FarmingSoilGrantResult {
  qty: number;
  inventory: Record<string, number>;
  storage: Record<string, number>;
}

/**
 * Grant any soil the player is owed up through `throughLevel`.
 * Idempotent via `farm.farmingSoilGrantedThroughLevel`.
 */
export async function syncFarmingSoilThroughLevel(
  userId: string,
  throughLevel: number,
): Promise<FarmingSoilGrantResult | null> {
  const farm = await Farm.findOne({ userId });
  if (!farm) return null;

  const claimed = Math.max(0, Math.floor(farm.farmingSoilGrantedThroughLevel ?? 0));
  const target = Math.max(0, Math.floor(throughLevel));
  if (target <= claimed) return null;

  const qty = soilQtyUnlockedBetween(claimed, target);
  farm.farmingSoilGrantedThroughLevel = target;
  farm.markModified('farmingSoilGrantedThroughLevel');

  if (qty > 0) {
    grantLoot(farm, FARMING_SOIL_ITEM_TYPE, qty);
    log.info({ userId, qty, from: claimed, to: target }, 'Granted farming soil from skill milestones');
  }

  await farm.save();

  if (qty <= 0) return null;

  return {
    qty,
    inventory: mapToRecord(farm.inventory),
    storage: mapToRecord(farm.storage ?? new Map()),
  };
}
