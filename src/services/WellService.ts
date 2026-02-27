/**
 * Well Service — Handles water collection from well buildings.
 *
 * Supports dynamic multiplier via slug: well → 1x, well_2 → 2x, well_5 → 5x, etc.
 * AI-created items with slug well_N automatically produce N× the base water amount.
 */

import { Farm } from '../models/Farm.js';
import { createLogger } from '../config/logger.js';
import { inventoryToRecord } from '../utils/recipeUtils.js';

const log = createLogger('WellService');

const WATER_ITEM = 'water';
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const BASE_MIN = 1;
const BASE_MAX = 10;

/**
 * Parses the water multiplier from a well slug.
 * - well or well_1 → 1
 * - well_N → N (e.g. well_2 → 2, well_5 → 5)
 */
export function parseWellMultiplier(wellSlug: string): number {
  if (!wellSlug || typeof wellSlug !== 'string') return 1;
  const trimmed = wellSlug.trim();
  if (trimmed === 'well' || trimmed === 'well_1') return 1;
  const match = trimmed.match(/^well_(\d+)$/);
  if (!match) return 1;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) || n < 1 ? 1 : Math.min(n, 999);
}

/**
 * Collects water from a well. Applies cooldown and slug-based multiplier.
 *
 * @param userId - The user collecting water
 * @param wellSlug - The well's itemType (e.g. 'well', 'well_2', 'well_5')
 * @returns Result with waterQty and nextAvailableAt, or null if on cooldown
 */
export async function collectWater(
  userId: string,
  wellSlug: string,
): Promise<{ waterQty: number; nextAvailableAt: Date; inventory: Record<string, number> } | null> {
  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');

  const now = new Date();
  const lastAt = farm.lastWellCollectAt;
  const nextAvailable = lastAt ? new Date(lastAt.getTime() + COOLDOWN_MS) : now;

  if (lastAt && now.getTime() < nextAvailable.getTime()) {
    return null; // On cooldown
  }

  const multiplier = parseWellMultiplier(wellSlug);
  const baseRoll = BASE_MIN + Math.floor(Math.random() * (BASE_MAX - BASE_MIN + 1));
  const waterQty = baseRoll * multiplier;

  farm.lastWellCollectAt = now;
  const current = farm.inventory.get(WATER_ITEM) ?? 0;
  farm.inventory.set(WATER_ITEM, current + waterQty);
  farm.markModified('inventory');
  await farm.save();

  log.info({ userId, wellSlug, multiplier, waterQty }, 'Water collected');

  return {
    waterQty,
    nextAvailableAt: new Date(now.getTime() + COOLDOWN_MS),
    inventory: inventoryToRecord(farm.inventory),
  };
}

/**
 * Returns the next available collect time when user is on cooldown.
 * Used to send nextAvailableAt to client for countdown display.
 */
export async function getWellCooldown(userId: string): Promise<Date | null> {
  const farm = await Farm.findOne({ userId });
  if (!farm?.lastWellCollectAt) return null;
  const nextAvailable = new Date(farm.lastWellCollectAt.getTime() + COOLDOWN_MS);
  if (Date.now() >= nextAvailable.getTime()) return null;
  return nextAvailable;
}
