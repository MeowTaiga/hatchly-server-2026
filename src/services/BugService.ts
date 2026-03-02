import crypto from 'crypto';
import { Farm } from '../models/Farm.js';
import { GameItemDef, type IGameItemDef, type BugRarity, type BugActiveTime } from '../models/GameItemDef.js';
import { UserCollection } from '../models/UserCollection.js';
import { farmService } from './FarmService.js';
import { questService } from './QuestService.js';
import { createLogger } from '../config/logger.js';
import { RARITY_WEIGHTS, RARITY_GEM_MULTIPLIER } from '../utils/rarity.js';

const log = createLogger('BugService');

/** How long a bug stays on the map before it despawns (ms). */
export const BUG_LIFESPAN_MS = 60_000;

/** Min interval between spawn attempts (ms). */
export const BUG_SPAWN_MIN_MS = 30_000;

/** Max interval between spawn attempts (ms). */
export const BUG_SPAWN_MAX_MS = 90_000;

/** Maximum number of bugs alive on one farm at a time. */
export const MAX_ACTIVE_BUGS = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActiveBug {
  spawnId: string;
  itemType: string;
  col: number;
  row: number;
  /** Timestamp when this bug was spawned (for lifespan tracking). */
  spawnedAt: number;
  /** Cached def reference so we don't re-query on catch. */
  def: IGameItemDef;
  /** If set, bug is "on" this item — client uses subtle drift/rotate AI. */
  hostPlacedItemId?: string;
}

export interface CatchResult {
  spawnId: string;
  itemType: string;
  label: string;
  size: number;
  gemsAwarded: number;
  sizeLabel: string;
  rarity: BugRarity;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function genSpawnId(): string {
  return 'bug_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Bell-curve random using Box-Muller transform.
 * Returns a value between min and max with a normal distribution
 * centered at the midpoint (~68% within the middle third).
 */
function bellCurveRandom(min: number, max: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const normalized = Math.max(0, Math.min(1, 0.5 + z * 0.17));
  return +(min + normalized * (max - min)).toFixed(2);
}

/** Derive a human-readable size label from the rolled size relative to the range. */
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

/**
 * Boost applied to bugs whose bugActiveTime matches the current period.
 * A 4x multiplier yields ~80/20 split vs all_day bugs of the same rarity.
 */
const TIME_MATCH_BOOST = 4;

/** Pick one bug def using rarity weight + time-of-day boost. */
function weightedPick(defs: IGameItemDef[], currentPeriod: BugActiveTime): IGameItemDef {
  let totalWeight = 0;
  const weights = defs.map((d) => {
    let w = RARITY_WEIGHTS[(d as any).bugRarity as BugRarity] ?? RARITY_WEIGHTS.common;
    const activeTime = ((d as any).bugActiveTime as BugActiveTime) || 'all_day';
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

/** Get eligible spawn tiles for a bug that has bugSpawnOn. Returns tile coords + host item id. */
function getEligibleSpawnTiles(
  placedItems: { id: string; itemType: string; col: number; row: number; tileCols: number; tileRows: number; anchorId?: string }[],
  itemDefs: Record<string, IGameItemDef>,
  bugSpawnOn: string[],
  gridCols: number,
  gridRows: number,
): { col: number; row: number; hostPlacedItemId: string }[] {
  const candidates: { col: number; row: number; hostPlacedItemId: string }[] = [];
  for (const item of placedItems) {
    if (item.anchorId) continue;
    const hostId = item.id;
    const def = itemDefs[item.itemType];
    if (!def) continue;
    let matches = false;
    for (const hab of bugSpawnOn) {
      if (hab === 'light_source') {
        if ((def.lightRadius ?? 0) > 0) {
          matches = true;
          break;
        }
      } else if (def.subCategory === hab) {
        matches = true;
        break;
      }
    }
    if (!matches) continue;
    const centerCol = item.col + Math.floor(item.tileCols / 2);
    const centerRow = item.row + Math.floor(item.tileRows / 2);
    if (centerCol >= 1 && centerCol < gridCols - 1 && centerRow >= 2 && centerRow < gridRows - 2) {
      candidates.push({ col: centerCol, row: centerRow, hostPlacedItemId: hostId });
    }
  }
  return candidates;
}

/** Determine the current time-of-day period from an IANA timezone. */
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

// ─── In-memory active bug tracking per user ─────────────────────────────────

const activeBugsMap = new Map<string, ActiveBug[]>();

function getActiveBugs(userId: string): ActiveBug[] {
  let bugs = activeBugsMap.get(userId);
  if (!bugs) {
    bugs = [];
    activeBugsMap.set(userId, bugs);
  }
  return bugs;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const bugService = {
  /**
   * Attempt to spawn a bug on the user's farm.
   * Filters by time-of-day, scene, and uses rarity-weighted random selection.
   * Returns the spawned bug info, or null if at capacity or no eligible defs exist.
   * @param sceneSlug - Current scene (e.g. 'farm', 'mines'). Defaults to 'farm'.
   */
  async spawnBug(userId: string, timezone?: string, sceneSlug = 'farm'): Promise<ActiveBug | null> {
    const bugs = getActiveBugs(userId);

    // Prune expired bugs
    const now = Date.now();
    const expired = bugs.filter((b) => now - b.spawnedAt >= BUG_LIFESPAN_MS);
    for (const e of expired) {
      const idx = bugs.indexOf(e);
      if (idx >= 0) bugs.splice(idx, 1);
    }

    if (bugs.length >= MAX_ACTIVE_BUGS) return null;

    const allBugDefs = await GameItemDef.find({ category: 'bug' }).lean();
    if (allBugDefs.length === 0) return null;

    // Filter to bugs active during the user's current time period and scene
    const period = getCurrentTimePeriod(timezone);
    const eligible = allBugDefs.filter((d) => {
      const activeTime = ((d as any).bugActiveTime as BugActiveTime) || 'all_day';
      if (activeTime !== 'all_day' && activeTime !== period) return false;
      const scenes = (d as any).bugScenes as string[] | undefined;
      if (!scenes?.length) return true;
      return scenes.includes(sceneSlug);
    });
    if (eligible.length === 0) return null;

    const def = weightedPick(eligible as IGameItemDef[], period);
    const bugSpawnOn = (def as any).bugSpawnOn as string[] | undefined;
    let col: number;
    let row: number;
    let hostPlacedItemId: string | undefined;

    if (bugSpawnOn?.length) {
      const [farm, { gridCols, gridRows }] = await Promise.all([
        Farm.findOne({ userId }).lean(),
        farmService.getGridDimensions(userId),
      ]);
      if (!farm?.placedItems?.length) {
        return null;
      }
      const itemDefs = await GameItemDef.find().lean();
      const itemDefsMap: Record<string, IGameItemDef> = {};
      for (const d of itemDefs) itemDefsMap[d.itemType] = d as IGameItemDef;
      const tiles = getEligibleSpawnTiles(farm.placedItems, itemDefsMap, bugSpawnOn, gridCols, gridRows);
      if (tiles.length === 0) return null;
      const picked = tiles[Math.floor(Math.random() * tiles.length)];
      col = picked.col;
      row = picked.row;
      hostPlacedItemId = picked.hostPlacedItemId;
    } else {
      const { gridCols, gridRows } = await farmService.getGridDimensions(userId);
      // Avoid edges; clamp for dynamic/small grids (gridCols/rows from scene or level)
      const colRange = Math.max(1, gridCols - 2);
      const rowRange = Math.max(1, gridRows - 4);
      col = Math.min(gridCols - 1, Math.floor(Math.random() * colRange) + 1);
      row = Math.min(gridRows - 1, Math.floor(Math.random() * rowRange) + 2);
    }

    const bug: ActiveBug = {
      spawnId: genSpawnId(),
      itemType: def.itemType,
      col,
      row,
      spawnedAt: now,
      def: def as IGameItemDef,
      hostPlacedItemId,
    };

    bugs.push(bug);
    log.info({ userId, spawnId: bug.spawnId, itemType: bug.itemType, col, row, rarity: (def as any).bugRarity ?? 'common' }, 'Bug spawned');
    return bug;
  },

  /**
   * Process a bug catch. Rolls size via bell curve, awards gems, saves to collection.
   * Returns the catch result, or null if the spawn ID is invalid/expired.
   */
  async catchBug(userId: string, spawnId: string): Promise<{ catchResult: CatchResult; stateUpdate: Record<string, any> } | null> {
    const bugs = getActiveBugs(userId);
    const idx = bugs.findIndex((b) => b.spawnId === spawnId);
    if (idx < 0) return null;

    const bug = bugs[idx];
    bugs.splice(idx, 1);

    const def = bug.def;
    const sizeMin = def.bugSizeMin ?? 0.5;
    const sizeMax = def.bugSizeMax ?? 2.0;
    const size = bellCurveRandom(sizeMin, sizeMax);
    const rarity: BugRarity = (def as any).bugRarity ?? 'common';
    const gemsAwarded = 0;
    const sizeLabel = getSizeLabel(size, sizeMin, sizeMax);

    // Save to user's collection
    await UserCollection.create({
      userId,
      category: 'bug',
      itemType: bug.itemType,
      size,
      gemsAwarded,
      caughtAt: new Date(),
    });

    // Update farm: add bug to inventory
    const farm = await Farm.findOne({ userId });
    if (farm) {
      const current = farm.inventory.get(bug.itemType) ?? 0;
      farm.inventory.set(bug.itemType, current + 1);
      farm.markModified('inventory');
      await farm.save();
    }

    log.info({ userId, spawnId, itemType: bug.itemType, size, gemsAwarded, sizeLabel, rarity }, 'Bug caught');

    // Track quest action for catching bugs + always refresh quests
    await questService.trackAction(userId, 'catch', bug.itemType);
    const autoCompleted = await questService.autoCompleteEligibleQuests(userId);

    // Re-read farm if quests auto-completed (rewards may have changed gems/inventory)
    const freshFarm = autoCompleted.length > 0 ? await Farm.findOne({ userId }) : farm;
    const quests = await questService.getQuestsForUser(userId);

    const catchResult: CatchResult = {
      spawnId,
      itemType: bug.itemType,
      label: def.label,
      size,
      gemsAwarded,
      sizeLabel,
      rarity,
    };

    const inventoryRecord: Record<string, number> = {};
    if (freshFarm) {
      for (const [k, v] of freshFarm.inventory) {
        if (v > 0) inventoryRecord[k] = v;
      }
    }

    return {
      catchResult,
      stateUpdate: {
        gems: freshFarm?.gems ?? 0,
        inventory: inventoryRecord,
        quests,
        autoCompletedQuests: autoCompleted.length > 0 ? autoCompleted : undefined,
      },
    };
  },

  /** Get active bug positions for PetAI targeting (pet can walk to admire). */
  getActiveBugsForPet(userId: string): { col: number; row: number }[] {
    const bugs = getActiveBugs(userId);
    const now = Date.now();
    return bugs
      .filter((b) => now - b.spawnedAt < BUG_LIFESPAN_MS)
      .map((b) => ({ col: b.col, row: b.row }));
  },

  /** Get expired bugs for a user (for despawn notifications). */
  getExpiredBugs(userId: string): ActiveBug[] {
    const bugs = getActiveBugs(userId);
    const now = Date.now();
    return bugs.filter((b) => now - b.spawnedAt >= BUG_LIFESPAN_MS);
  },

  /** Remove a specific bug from active tracking (e.g. on despawn). */
  removeBug(userId: string, spawnId: string): boolean {
    const bugs = getActiveBugs(userId);
    const idx = bugs.findIndex((b) => b.spawnId === spawnId);
    if (idx < 0) return false;
    bugs.splice(idx, 1);
    return true;
  },

  /** Clean up all active bugs for a user (on disconnect). */
  clearBugs(userId: string): void {
    activeBugsMap.delete(userId);
  },

  /** Get next random spawn delay. */
  getSpawnDelay(): number {
    return BUG_SPAWN_MIN_MS + Math.random() * (BUG_SPAWN_MAX_MS - BUG_SPAWN_MIN_MS);
  },
};
