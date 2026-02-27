import { Scene } from '../models/Scene.js';
import { GameItemDef, type IGameItemDef, type BugRarity, type BugActiveTime } from '../models/GameItemDef.js';
import { UserCollection } from '../models/UserCollection.js';
import { Farm } from '../models/Farm.js';
import { questService } from './QuestService.js';
import { createLogger } from '../config/logger.js';
import { RARITY_WEIGHTS, RARITY_TO_DIFFICULTY } from '../utils/rarity.js';

const log = createLogger('FishService');

// ─── Constants ──────────────────────────────────────────────────────────────

const BITE_DELAY_MIN_MS = 3_000;
const BITE_DELAY_MAX_MS = 40_000;

/** Time-of-day boost for fish matching current period (same as BugService). */
const TIME_MATCH_BOOST = 4;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FishCatchResult {
  itemType: string;
  label: string;
  size: number;
  sizeLabel: string;
  /** Rarity tier for display (border/background color). */
  rarity: BugRarity;
  gemsAwarded: number;
  imageUrl?: string;
  /** Mini-game difficulty 1-5 (from fish rarity). */
  difficulty?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bellCurveRandom(min: number, max: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const normalized = Math.max(0, Math.min(1, 0.5 + z * 0.17));
  return +(min + normalized * (max - min)).toFixed(2);
}

function getSizeLabel(size: number, min: number, max: number): string {
  const range = max - min;
  if (range <= 0) return 'Average';
  const pct = (size - min) / range;
  if (pct <= 0.15) return 'Tiny';
  if (pct <= 0.35) return 'Small';
  if (pct <= 0.65) return 'Average';
  if (pct <= 0.85) return 'Large';
  return 'Huge';
}

function getCurrentTimePeriod(timezone?: string): BugActiveTime {
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone || 'UTC' }).format(new Date()),
      10,
    );
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'night';
  } catch {
    return 'morning';
  }
}

/** Pick one fish def using rarity weight + time-of-day boost. */
function weightedPickFish(defs: IGameItemDef[], currentPeriod: BugActiveTime): IGameItemDef {
  let totalWeight = 0;
  const weights = defs.map((d) => {
    const fishRarity = (d as any).fishRarity as BugRarity | undefined;
    let w = RARITY_WEIGHTS[fishRarity ?? 'common'];
    const activeTime = ((d as any).fishActiveTime as BugActiveTime) || 'all_day';
    if (activeTime !== 'all_day' && activeTime === currentPeriod) {
      w *= TIME_MATCH_BOOST;
    }
    totalWeight += w;
    return w;
  });
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < defs.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return defs[i];
  }
  return defs[defs.length - 1];
}

// ─── State ──────────────────────────────────────────────────────────────────

interface PendingBite {
  timeoutId: ReturnType<typeof setTimeout>;
  sceneSlug: string;
  col: number;
  row: number;
}

interface AwaitingResult {
  sceneSlug: string;
  col: number;
  row: number;
}

const pendingMap = new Map<string, PendingBite>();
const awaitingResultMap = new Map<string, AwaitingResult>();
const preRollMap = new Map<string, FishCatchResult>();

// ─── Service ─────────────────────────────────────────────────────────────────

export const fishService = {
  /**
   * Schedule the bite and store pending state. Call validateFishingTile first.
   * Returns { scheduledAt } and invokes onBite when the timer fires.
   */
  scheduleBite(
    userId: string,
    sceneSlug: string,
    col: number,
    row: number,
    onBite: (userId: string) => void,
  ): { scheduledAt: Date } {
    this.cancelFishing(userId);

    const delayMs = BITE_DELAY_MIN_MS + Math.random() * (BITE_DELAY_MAX_MS - BITE_DELAY_MIN_MS);
    const scheduledAt = new Date(Date.now() + delayMs);

    const timeoutId = setTimeout(() => {
      const pending = pendingMap.get(userId);
      if (!pending) return;
      pendingMap.delete(userId);
      awaitingResultMap.set(userId, { sceneSlug: pending.sceneSlug, col: pending.col, row: pending.row });
      onBite(userId);
    }, delayMs);

    pendingMap.set(userId, { timeoutId, sceneSlug, col, row });
    return { scheduledAt };
  },

  /**
   * Pre-roll a fish at bite time so the client can display it during the mini game.
   * Stores the result for use in completeFishing.
   */
  async preRollFish(
    userId: string,
    sceneSlug: string,
    col: number,
    row: number,
    timezone?: string,
  ): Promise<FishCatchResult | null> {
    const result = await this.rollFish(sceneSlug, col, row, timezone);
    if (result) {
      preRollMap.set(userId, result);
    }
    return result;
  },

  /**
   * Complete a fishing attempt. Uses pre-rolled result if available, otherwise re-rolls.
   * If passed, persists to UserCollection + Farm, returns result.
   */
  async completeFishing(
    userId: string,
    passed: boolean,
    timezone?: string,
  ): Promise<{ caught: false } | { caught: true; result: FishCatchResult }> {
    const awaiting = awaitingResultMap.get(userId);
    awaitingResultMap.delete(userId);
    const preRolled = preRollMap.get(userId);
    preRollMap.delete(userId);
    if (!awaiting) return { caught: false };
    if (!passed) return { caught: false };

    const result = preRolled ?? await this.rollFish(awaiting.sceneSlug, awaiting.col, awaiting.row, timezone);
    if (!result) return { caught: false };

    // Save to UserCollection
    await UserCollection.create({
      userId,
      category: 'fish',
      itemType: result.itemType,
      size: result.size,
      gemsAwarded: result.gemsAwarded,
      caughtAt: new Date(),
    });

    // Update farm inventory
    const farm = await Farm.findOne({ userId });
    if (farm) {
      const current = farm.inventory.get(result.itemType) ?? 0;
      farm.inventory.set(result.itemType, current + 1);
      farm.markModified('inventory');
      await farm.save();
    }

    await questService.trackAction(userId, 'catch', result.itemType);

    log.info({ userId, itemType: result.itemType, size: result.size, gemsAwarded: result.gemsAwarded }, 'Fish caught');
    return { caught: true, result };
  },

  /** Cancel a scheduled fishing attempt. Returns true if something was cancelled. */
  cancelFishing(userId: string): boolean {
    const pending = pendingMap.get(userId);
    const hadAwaiting = awaitingResultMap.has(userId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingMap.delete(userId);
    }
    awaitingResultMap.delete(userId);
    preRollMap.delete(userId);
    return !!pending || hadAwaiting;
  },

  /**
   * Validate that (col, row) is a fishing tile in the scene.
   */
  async validateFishingTile(sceneSlug: string, col: number, row: number): Promise<boolean> {
    const scene = await Scene.findOne({ slug: sceneSlug }).lean();
    if (!scene?.fishingTiles?.length) return false;
    return scene.fishingTiles.some((t) => t.col === col && t.row === row);
  },

  /**
   * Roll a fish for the given fishing tile. Returns null if no eligible fish.
   */
  async rollFish(
    sceneSlug: string,
    col: number,
    row: number,
    timezone?: string,
  ): Promise<FishCatchResult | null> {
    const scene = await Scene.findOne({ slug: sceneSlug }).lean();
    if (!scene?.fishingTiles) return null;

    const tile = scene.fishingTiles.find((t) => t.col === col && t.row === row);
    const spotType = tile?.spotType ?? 'general';

    const allFishDefs = await GameItemDef.find({ category: 'fish' }).lean();
    if (allFishDefs.length === 0) return null;

    // Filter by fishSpotTypes: empty/undefined = all spots; otherwise must include spotType
    const eligible = allFishDefs.filter((d) => {
      const types = (d as any).fishSpotTypes as string[] | undefined;
      if (!types?.length) return true;
      return types.includes(spotType);
    });
    if (eligible.length === 0) return null;

    const period = getCurrentTimePeriod(timezone);
    const activeEligible = eligible.filter((d) => {
      const activeTime = ((d as any).fishActiveTime as BugActiveTime) || 'all_day';
      return activeTime === 'all_day' || activeTime === period;
    });
    const defs = activeEligible.length > 0 ? (activeEligible as IGameItemDef[]) : (eligible as IGameItemDef[]);

    const def = weightedPickFish(defs, period);
    const sizeMin = (def as any).fishSizeMin ?? 0.5;
    const sizeMax = (def as any).fishSizeMax ?? 2.0;
    const size = bellCurveRandom(sizeMin, sizeMax);
    const rarity: BugRarity = (def as any).fishRarity ?? 'common';
    const difficulty = RARITY_TO_DIFFICULTY[rarity];
    const sizeLabel = getSizeLabel(size, sizeMin, sizeMax);

    return {
      itemType: def.itemType,
      label: def.label,
      size,
      sizeLabel,
      rarity,
      gemsAwarded: 0,
      imageUrl: def.imageUrl,
      difficulty,
    };
  },
};
