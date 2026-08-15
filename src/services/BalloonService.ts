import crypto from 'crypto';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { BalloonLootConfig } from '../models/BalloonLootConfig.js';
import { farmService, withQuestSync } from './FarmService.js';
import { questService } from './quests/index.js';
import { createLogger } from '../config/logger.js';
import { RARITY_WEIGHTS, RARITY_GEM_MULTIPLIER, weightedPick } from '../utils/rarity.js';
import type { BugRarity } from '../models/GameItemDef.js';

const log = createLogger('BalloonService');

/** How long a balloon stays on the map before it despawns (ms). */
export const BALLOON_LIFESPAN_MS = 120_000;

/** Min interval between spawn attempts (ms). */
export const BALLOON_SPAWN_MIN_MS = 5 * 60 * 1000; // 5 min

/** Max interval between spawn attempts (ms). */
export const BALLOON_SPAWN_MAX_MS = 10 * 60 * 1000; // 10 min

/** Maximum number of balloons alive on one farm at a time. */
export const MAX_ACTIVE_BALLOONS = 1;

/** Fallback gems when loot pool is empty. */
const FALLBACK_GEMS = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActiveBalloon {
  spawnId: string;
  itemType: string;
  col: number;
  row: number;
  spawnedAt: number;
}

export interface BalloonPopResult {
  spawnId: string;
  itemType: string;
  label: string;
  qty: number;
  gemsAwarded?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function genSpawnId(): string {
  return 'balloon_' + crypto.randomBytes(6).toString('hex');
}

// ─── In-memory active balloon tracking per user ─────────────────────────────

const activeBalloonsMap = new Map<string, ActiveBalloon[]>();

function getActiveBalloons(userId: string): ActiveBalloon[] {
  let balloons = activeBalloonsMap.get(userId);
  if (!balloons) {
    balloons = [];
    activeBalloonsMap.set(userId, balloons);
  }
  return balloons;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const balloonService = {
  /**
   * Attempt to spawn a balloon on the user's farm.
   * Picks a random floating_balloon_* asset. Returns null if at capacity or no defs exist.
   */
  async spawnBalloon(userId: string): Promise<ActiveBalloon | null> {
    const balloons = getActiveBalloons(userId);

    const now = Date.now();
    const expired = balloons.filter((b) => now - b.spawnedAt >= BALLOON_LIFESPAN_MS);
    for (const e of expired) {
      const idx = balloons.indexOf(e);
      if (idx >= 0) balloons.splice(idx, 1);
    }

    if (balloons.length >= MAX_ACTIVE_BALLOONS) return null;

    const balloonDefs = await GameItemDef.find({
      category: 'asset',
      itemType: /^floating_balloon_/,
    }).lean();
    if (balloonDefs.length === 0) return null;

    const def = balloonDefs[Math.floor(Math.random() * balloonDefs.length)];
    const { gridCols, gridRows } = await farmService.getGridDimensions(userId);
    // Avoid edges; clamp for dynamic/small grids (gridCols/rows from scene or level)
    const colRange = Math.max(1, gridCols - 2);
    const rowRange = Math.max(1, gridRows - 4);
    const col = Math.min(gridCols - 1, Math.floor(Math.random() * colRange) + 1);
    const row = Math.min(gridRows - 1, Math.floor(Math.random() * rowRange) + 2);

    const balloon: ActiveBalloon = {
      spawnId: genSpawnId(),
      itemType: def.itemType,
      col,
      row,
      spawnedAt: now,
    };

    balloons.push(balloon);
    log.info({ userId, spawnId: balloon.spawnId, itemType: balloon.itemType, col, row }, 'Balloon spawned');
    return balloon;
  },

  /**
   * Pop a balloon. Rolls from BalloonLootConfig, adds item to inventory.
   * Returns pop result + state update, or null if spawnId invalid.
   */
  async popBalloon(userId: string, spawnId: string): Promise<{
    popResult: BalloonPopResult;
    stateUpdate: Record<string, any>;
  } | null> {
    const balloons = getActiveBalloons(userId);
    const idx = balloons.findIndex((b) => b.spawnId === spawnId);
    if (idx < 0) return null;

    const balloon = balloons[idx];
    balloons.splice(idx, 1);

    const config = await BalloonLootConfig.findOne().lean();
    const entries = config?.entries ?? [];
    const validItemTypes = new Set((await GameItemDef.find().lean()).map((d) => d.itemType));
    const eligible = entries.filter((e) => validItemTypes.has(e.itemType));

    let itemType: string;
    let label: string;
    let qty = 1;

    let gemsAwarded = 0;
    if (eligible.length === 0) {
      itemType = '';
      label = 'Gems';
      gemsAwarded = FALLBACK_GEMS;
    } else {
      const picked = weightedPick(eligible, (e) => e.weight ?? RARITY_WEIGHTS[e.rarity]);
      const def = await GameItemDef.findOne({ itemType: picked.itemType }).lean();
      itemType = picked.itemType;
      label = def?.label ?? picked.itemType;
    }

    const farm = await Farm.findOne({ userId });
    if (farm) {
      if (itemType) {
        const current = farm.inventory.get(itemType) ?? 0;
        farm.inventory.set(itemType, current + qty);
        farm.markModified('inventory');
      }
      if (gemsAwarded > 0) {
        farm.gems = (farm.gems ?? 0) + gemsAwarded;
      }
      await farm.save();
    }

    log.info({ userId, spawnId, itemType, qty }, 'Balloon popped');

    const sync = await questService.recordEvents(userId, {
      kind: 'action',
      action: 'pop_balloon',
      itemType: itemType || 'gems',
    });

    const popResult: BalloonPopResult = {
      spawnId,
      itemType: itemType || 'gems',
      label,
      qty: itemType ? qty : gemsAwarded,
      gemsAwarded: gemsAwarded > 0 ? gemsAwarded : undefined,
    };

    const inventoryRecord: Record<string, number> = {};
    if (farm) {
      for (const [k, v] of farm.inventory) {
        if (v > 0) inventoryRecord[k] = v;
      }
    }

    return {
      popResult,
      stateUpdate: withQuestSync({
        gems: farm?.gems ?? 0,
        inventory: inventoryRecord,
      }, sync),
    };
  },

  /** Get expired balloons for a user (for despawn notifications). */
  getExpiredBalloons(userId: string): ActiveBalloon[] {
    const balloons = getActiveBalloons(userId);
    const now = Date.now();
    return balloons.filter((b) => now - b.spawnedAt >= BALLOON_LIFESPAN_MS);
  },

  /** Remove a specific balloon from active tracking. */
  removeBalloon(userId: string, spawnId: string): boolean {
    const balloons = getActiveBalloons(userId);
    const idx = balloons.findIndex((b) => b.spawnId === spawnId);
    if (idx < 0) return false;
    balloons.splice(idx, 1);
    return true;
  },

  /** Clean up all active balloons for a user (on disconnect). */
  clearBalloons(userId: string): void {
    activeBalloonsMap.delete(userId);
  },

  /** Get next random spawn delay. */
  getSpawnDelay(): number {
    return BALLOON_SPAWN_MIN_MS + Math.random() * (BALLOON_SPAWN_MAX_MS - BALLOON_SPAWN_MIN_MS);
  },
};
