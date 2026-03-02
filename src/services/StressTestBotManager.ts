/**
 * StressTestBotManager — Spawns virtual "bot" players into multiplayer instances
 * for admin stress testing. Bots wander, fish, and appear as real players to clients.
 *
 * WebSocket flow: Bots are server-side only. The server emits mp:player_joined,
 * mp:player_moved, mp:fish_started, etc. via io.to(roomName).emit(). The admin
 * (and any real client in the room) receives these events over their WebSocket
 * connection — so the stress test validates client handling of many player updates.
 */
import { getIO } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { multiplayerManager } from './MultiplayerManager.js';
import { User } from '../models/User.js';
import { Scene } from '../models/Scene.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';
import type { SceneInstance } from './SceneInstance.js';

const log = createLogger('StressTestBotManager');

const BOT_ID_PREFIX = 'bot_stress_';
const TICK_MS = 200; // Run AI loop every 200ms for smooth, staggered updates
const MOVE_STEP_PX = 24; // Human-like step size (half a tile)
const MOVE_INTERVAL_MIN_MS = 800;
const MOVE_INTERVAL_MAX_MS = 2800;
const IDLE_CHANCE = 0.15; // Chance to stand still for a tick
const FISH_INTERVAL_MIN_MS = 6000;
const FISH_INTERVAL_MAX_MS = 18000;
const BITE_DELAY_MS = 4000;
const REEL_DURATION_MS = 3000;

/** 8 directions + idle, for natural movement */
const DIRECTIONS = [
  { dx: 0, dy: -1 },   // N
  { dx: 1, dy: -1 },   // NE
  { dx: 1, dy: 0 },    // E
  { dx: 1, dy: 1 },    // SE
  { dx: 0, dy: 1 },    // S
  { dx: -1, dy: 1 },   // SW
  { dx: -1, dy: 0 },   // W
  { dx: -1, dy: -1 },  // NW
];

interface BotAIState {
  nextMoveAt: number;
  direction: { dx: number; dy: number };
  directionChangeAt: number;
}

interface BotState {
  instance: SceneInstance;
  sceneSlug: string;
  roomName: string;
  fishingTiles: Array<{ col: number; row: number }>;
  walkBounds: { x: number; y: number; w: number; h: number } | null;
  botAI: Map<string, BotAIState>;
  tickTimer: ReturnType<typeof setInterval>;
  fishTimeoutId: ReturnType<typeof setTimeout> | null;
}

const botStates = new Map<string, BotState>();

const TILE_SIZE = 48;

/** Get a default fishing pole item type for bots. */
async function getDefaultFishingPole(): Promise<string> {
  const def = await GameItemDef.findOne({
    $or: [{ subCategory: 'fishing_poles' }, { subCategory: 'fishing_pole' }],
  })
    .select('itemType')
    .lean();
  return def?.itemType ?? 'fishing_pole';
}

/**
 * Spawn stress test bots into the admin's current multiplayer instance.
 * Uses admin's pet data for display. Bots wander and fish.
 */
export async function spawnStressTestBots(adminUserId: string, count: number): Promise<{ spawned: number; error?: string }> {
  const instance = multiplayerManager.getInstanceForUser(adminUserId);
  if (!instance) {
    return { spawned: 0, error: 'You must be in a multiplayer scene to spawn bots' };
  }

  const sceneSlug = instance.sceneSlug;
  const roomName = instance.roomName;
  const maxToSpawn = Math.max(0, instance.maxPlayers - instance.playerCount());
  if (maxToSpawn === 0) {
    return { spawned: 0, error: 'Instance is full' };
  }

  const toSpawn = Math.min(count, maxToSpawn);

  const [adminUser, scene, fishingPole] = await Promise.all([
    User.findById(adminUserId).select('pet').lean(),
    Scene.findOne({ slug: sceneSlug }).select('fishingTiles walkableRect').lean(),
    getDefaultFishingPole(),
  ]);

  const pet = adminUser?.pet;
  const petName = pet?.customName ?? pet?.name ?? 'Pet';
  const petImageUrl = pet?.imageUrl ?? '';
  const petPose = pet?.pose;
  const fishingTiles = scene?.fishingTiles ?? [];
  const walkBounds = scene?.walkableRect
    ? { x: scene.walkableRect.x, y: scene.walkableRect.y, w: scene.walkableRect.w, h: scene.walkableRect.h }
    : null;

  const io = getIO();
  const existingBotCount = Array.from(instance.getPlayerList()).filter((p) => p.userId.startsWith(BOT_ID_PREFIX)).length;
  const startIndex = existingBotCount + 1;

  for (let i = 0; i < toSpawn; i++) {
    const botNum = startIndex + i;
    const botId = `${BOT_ID_PREFIX}${botNum}`;
    const username = `Bot ${botNum}`;

    const player = instance.addPlayer(botId, username, petName, petImageUrl, petPose, {
      handTool: fishingPole,
    });

    io.to(roomName).emit(WS_EVENTS.MP_PLAYER_JOINED, {
      userId: botId,
      username,
      petName,
      petImageUrl,
      petPose,
      x: player.x,
      y: player.y,
      equippedHandTool: fishingPole,
    });
  }

  // Start or restart the AI loop for this instance
  const existingState = botStates.get(roomName);
  if (existingState) {
    clearInterval(existingState.tickTimer);
    if (existingState.fishTimeoutId) clearTimeout(existingState.fishTimeoutId);
  }

  const now = Date.now();
  const botAI = new Map<string, BotAIState>();
  for (const p of instance.getPlayerList().filter((p) => p.userId.startsWith(BOT_ID_PREFIX))) {
    const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    botAI.set(p.userId, {
      nextMoveAt: now + MOVE_INTERVAL_MIN_MS + Math.random() * (MOVE_INTERVAL_MAX_MS - MOVE_INTERVAL_MIN_MS),
      direction: dir,
      directionChangeAt: now + 1000 + Math.random() * 3000,
    });
  }

  const tickTimer = setInterval(() => {
    const state = botStates.get(roomName);
    if (!state) return;
    const now = Date.now();
    const bots = state.instance.getPlayerList().filter((p) => p.userId.startsWith(BOT_ID_PREFIX));
    for (const p of bots) {
      let ai = state.botAI.get(p.userId);
      if (!ai) {
        ai = {
          nextMoveAt: now,
          direction: DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)],
          directionChangeAt: now + 1000,
        };
        state.botAI.set(p.userId, ai);
      }
      if (now < ai.nextMoveAt) continue;
      if (Math.random() < IDLE_CHANCE) {
        ai.nextMoveAt = now + 400 + Math.random() * 1200;
        continue;
      }
      if (now > ai.directionChangeAt) {
        ai.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
        ai.directionChangeAt = now + 800 + Math.random() * 2500;
      }
      const step = MOVE_STEP_PX * (0.7 + Math.random() * 0.6);
      const newX = p.x + ai.direction.dx * step;
      const newY = p.y + ai.direction.dy * step;
      const updated = state.instance.updatePosition(p.userId, newX, newY);
      if (updated) {
        const updatedPlayer = state.instance.getPlayer(p.userId)!;
        io.to(roomName).emit(WS_EVENTS.MP_PLAYER_MOVED, {
          userId: p.userId,
          x: updatedPlayer.x,
          y: updatedPlayer.y,
        });
      }
      ai.nextMoveAt = now + MOVE_INTERVAL_MIN_MS + Math.random() * (MOVE_INTERVAL_MAX_MS - MOVE_INTERVAL_MIN_MS);
    }
  }, TICK_MS);

  const scheduleNextFish = (): ReturnType<typeof setTimeout> => {
    const delay = FISH_INTERVAL_MIN_MS + Math.random() * (FISH_INTERVAL_MAX_MS - FISH_INTERVAL_MIN_MS);
    return setTimeout(() => {
      const state = botStates.get(roomName);
      if (!state || state.fishingTiles.length === 0) return;
      const bots = state.instance.getPlayerList().filter((p) => p.userId.startsWith(BOT_ID_PREFIX));
      if (bots.length === 0) return;
      const bot = bots[Math.floor(Math.random() * bots.length)];
      const tile = state.fishingTiles[Math.floor(Math.random() * state.fishingTiles.length)];
      if (!tile) {
        state.fishTimeoutId = scheduleNextFish();
        return;
      }
      io.to(roomName).emit(WS_EVENTS.MP_FISH_STARTED, { userId: bot.userId, col: tile.col, row: tile.row });
      setTimeout(() => {
        io.to(roomName).emit(WS_EVENTS.MP_FISH_REELING, { userId: bot.userId });
      }, BITE_DELAY_MS);
      setTimeout(() => {
        const caught = Math.random() > 0.4;
        if (caught) {
          io.to(roomName).emit(WS_EVENTS.MP_FISH_CAUGHT, {
            userId: bot.userId,
            username: bot.username,
            itemType: 'test_fish',
            label: 'Test Fish',
            size: 12,
            sizeLabel: 'Small',
            rarity: 'common',
          });
        } else {
          io.to(roomName).emit(WS_EVENTS.MP_FISH_FAILED, { userId: bot.userId });
        }
        const s = botStates.get(roomName);
        if (s) s.fishTimeoutId = scheduleNextFish();
      }, BITE_DELAY_MS + REEL_DURATION_MS);
    }, delay);
  };

  const state: BotState = {
    instance,
    sceneSlug,
    roomName,
    fishingTiles,
    walkBounds,
    botAI,
    tickTimer,
    fishTimeoutId: scheduleNextFish(),
  };
  botStates.set(roomName, state);

  log.info({ adminUserId, sceneSlug, count: toSpawn }, 'Stress test bots spawned');
  return { spawned: toSpawn };
}

/**
 * Remove all stress test bots from the admin's instance.
 */
export function removeStressTestBots(adminUserId: string): { removed: number } {
  const instance = multiplayerManager.getInstanceForUser(adminUserId);
  if (!instance) return { removed: 0 };

  const roomName = instance.roomName;
  const players = instance.getPlayerList();
  const bots = players.filter((p) => p.userId.startsWith(BOT_ID_PREFIX));
  const io = getIO();

  for (const bot of bots) {
    instance.removePlayer(bot.userId);
    io.to(roomName).emit(WS_EVENTS.MP_PLAYER_LEFT, { userId: bot.userId });
  }

  const state = botStates.get(roomName);
  if (state && bots.length > 0) {
    const remainingBots = instance.getPlayerList().filter((p) => p.userId.startsWith(BOT_ID_PREFIX));
    if (remainingBots.length === 0) {
      clearInterval(state.tickTimer);
      if (state.fishTimeoutId) clearTimeout(state.fishTimeoutId);
      botStates.delete(roomName);
    }
  }

  log.info({ adminUserId, removed: bots.length }, 'Stress test bots removed');
  return { removed: bots.length };
}
