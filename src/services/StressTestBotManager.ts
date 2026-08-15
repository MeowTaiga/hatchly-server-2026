/**
 * StressTestBotManager — Spawns virtual "bot" players into multiplayer instances
 * for admin stress testing. Bots wander, fish, trade, and appear as real players.
 *
 * Appearance: random pet image/pose sampled from real users in the DB, plus a
 * random username. Trading uses virtual inventories (see TradeService).
 */
import { emitToUser, getIO } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { multiplayerManager } from './MultiplayerManager.js';
import { User } from '../models/User.js';
import { Scene } from '../models/Scene.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';
import type { SceneInstance } from './SceneInstance.js';
import { BOT_ID_PREFIX, isStressBot } from './stressBotIds.js';
import { tradeService } from './TradeService.js';

export { BOT_ID_PREFIX, isStressBot };

const log = createLogger('StressTestBotManager');

const TICK_MS = 200;
const MOVE_STEP_PX = 24;
const MOVE_INTERVAL_MIN_MS = 800;
const MOVE_INTERVAL_MAX_MS = 2800;
const IDLE_CHANCE = 0.15;
const FISH_INTERVAL_MIN_MS = 6000;
const FISH_INTERVAL_MAX_MS = 18000;
const BITE_DELAY_MS = 4000;
const REEL_DURATION_MS = 3000;

const DIRECTIONS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

const USERNAME_PREFIXES = [
  'Mochi', 'Bean', 'Pip', 'Nori', 'Coco', 'Ziggy', 'Pebble', 'Sunny',
  'Maple', 'Juniper', 'Pixel', 'Boba', 'Kiwi', 'Moss', 'Coral', 'Dusty',
];
const USERNAME_SUFFIXES = [
  'Swift', 'Bloom', 'Spark', 'Drift', 'Glow', 'Hop', 'Dash', 'Wisp',
  'Trail', 'Nest', 'Wave', 'Leaf', 'Star', 'Puff', 'Reed', 'Shade',
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

async function getDefaultFishingPole(): Promise<string> {
  const def = await GameItemDef.findOne({
    $or: [{ subCategory: 'fishing_poles' }, { subCategory: 'fishing_pole' }],
  })
    .select('itemType')
    .lean();
  return def?.itemType ?? 'fishing_pole';
}

function randomUsername(botNum: number): string {
  const a = USERNAME_PREFIXES[Math.floor(Math.random() * USERNAME_PREFIXES.length)];
  const b = USERNAME_SUFFIXES[Math.floor(Math.random() * USERNAME_SUFFIXES.length)];
  const n = 10 + Math.floor(Math.random() * 90);
  // Keep unique-ish even if adjective pair collides.
  return `${a}${b}${n}`;
}

interface PetAppearance {
  petName: string;
  petImageUrl: string;
  petPose?: Record<string, string>;
}

/** Sample random pets that already have generated images in the DB. */
async function samplePetAppearances(count: number): Promise<PetAppearance[]> {
  const size = Math.min(Math.max(count * 3, 12), 80);
  try {
    const rows = await User.aggregate<{
      pet?: {
        name?: string;
        customName?: string;
        imageUrl?: string;
        pose?: Record<string, string>;
      };
    }>([
      {
        $match: {
          'pet.imageUrl': { $type: 'string', $ne: '' },
        },
      },
      { $sample: { size } },
      {
        $project: {
          'pet.name': 1,
          'pet.customName': 1,
          'pet.imageUrl': 1,
          'pet.pose': 1,
        },
      },
    ]);

    return rows
      .filter((r) => r.pet?.imageUrl)
      .map((r) => ({
        petName: r.pet!.customName || r.pet!.name || 'Buddy',
        petImageUrl: r.pet!.imageUrl!,
        petPose: r.pet!.pose,
      }));
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to sample pet appearances');
    return [];
  }
}

/**
 * Spawn stress test bots into the admin's current multiplayer instance.
 */
export async function spawnStressTestBots(
  adminUserId: string,
  count: number,
): Promise<{ spawned: number; error?: string }> {
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

  const [adminUser, scene, fishingPole, appearances] = await Promise.all([
    User.findById(adminUserId).select('pet').lean(),
    Scene.findOne({ slug: sceneSlug }).select('fishingTiles walkableRect').lean(),
    getDefaultFishingPole(),
    samplePetAppearances(toSpawn),
  ]);

  const fallback: PetAppearance = {
    petName: adminUser?.pet?.customName ?? adminUser?.pet?.name ?? 'Pet',
    petImageUrl: adminUser?.pet?.imageUrl ?? '',
    petPose: adminUser?.pet?.pose as Record<string, string> | undefined,
  };

  const fishingTiles = scene?.fishingTiles ?? [];
  const walkBounds = scene?.walkableRect
    ? {
        x: scene.walkableRect.x,
        y: scene.walkableRect.y,
        w: scene.walkableRect.w,
        h: scene.walkableRect.h,
      }
    : null;

  const io = getIO();
  const existingBotCount = Array.from(instance.getPlayerList()).filter((p) =>
    isStressBot(p.userId),
  ).length;
  const startIndex = existingBotCount + 1;

  for (let i = 0; i < toSpawn; i++) {
    const botNum = startIndex + i;
    const botId = `${BOT_ID_PREFIX}${botNum}_${Date.now().toString(36)}_${i}`;
    const username = randomUsername(botNum);
    const look =
      appearances.length > 0
        ? appearances[Math.floor(Math.random() * appearances.length)]
        : fallback;
    const petName = look.petName;
    const petImageUrl = look.petImageUrl || fallback.petImageUrl;
    const petPose = look.petPose ?? fallback.petPose;

    const player = instance.addPlayer(botId, username, petName, petImageUrl, petPose, {
      handTool: fishingPole,
    });
    multiplayerManager.bindPresence(botId, instance);
    await tradeService.seedBotInventory(botId);

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

  const existingState = botStates.get(roomName);
  if (existingState) {
    clearInterval(existingState.tickTimer);
    if (existingState.fishTimeoutId) clearTimeout(existingState.fishTimeoutId);
  }

  const now = Date.now();
  const botAI = new Map<string, BotAIState>();
  for (const p of instance.getPlayerList().filter((p) => isStressBot(p.userId))) {
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
    const t = Date.now();
    const bots = state.instance.getPlayerList().filter((p) => isStressBot(p.userId));
    for (const p of bots) {
      let ai = state.botAI.get(p.userId);
      if (!ai) {
        ai = {
          nextMoveAt: t,
          direction: DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)],
          directionChangeAt: t + 1000,
        };
        state.botAI.set(p.userId, ai);
      }
      if (t < ai.nextMoveAt) continue;
      if (Math.random() < IDLE_CHANCE) {
        ai.nextMoveAt = t + 400 + Math.random() * 1200;
        continue;
      }
      if (t > ai.directionChangeAt) {
        ai.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
        ai.directionChangeAt = t + 800 + Math.random() * 2500;
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
      ai.nextMoveAt = t + MOVE_INTERVAL_MIN_MS + Math.random() * (MOVE_INTERVAL_MAX_MS - MOVE_INTERVAL_MIN_MS);
    }
  }, TICK_MS);

  const scheduleNextFish = (): ReturnType<typeof setTimeout> => {
    const delay = FISH_INTERVAL_MIN_MS + Math.random() * (FISH_INTERVAL_MAX_MS - FISH_INTERVAL_MIN_MS);
    return setTimeout(() => {
      const state = botStates.get(roomName);
      if (!state || state.fishingTiles.length === 0) return;
      const bots = state.instance.getPlayerList().filter((p) => isStressBot(p.userId));
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
export async function removeStressTestBots(adminUserId: string): Promise<{ removed: number }> {
  const instance = multiplayerManager.getInstanceForUser(adminUserId);
  if (!instance) return { removed: 0 };

  const roomName = instance.roomName;
  const players = instance.getPlayerList();
  const bots = players.filter((p) => isStressBot(p.userId));
  const io = getIO();

  for (const bot of bots) {
    const cancelled = await tradeService.cancelForUser(bot.userId);
    if (cancelled) {
      for (const uid of [cancelled.initiatorUserId, cancelled.recipientUserId]) {
        if (isStressBot(uid)) continue;
        const inv = cancelled.inventories[uid];
        if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
        emitToUser(uid, WS_EVENTS.MP_TRADE_CANCELLED, {
          tradeId: cancelled.tradeId,
          reason: 'Bot left the area',
        });
      }
    }
    tradeService.clearBotInventory(bot.userId);
    instance.removePlayer(bot.userId);
    multiplayerManager.unbindPresence(bot.userId);
    io.to(roomName).emit(WS_EVENTS.MP_PLAYER_LEFT, { userId: bot.userId });
  }

  const state = botStates.get(roomName);
  if (state && bots.length > 0) {
    const remainingBots = instance.getPlayerList().filter((p) => isStressBot(p.userId));
    if (remainingBots.length === 0) {
      clearInterval(state.tickTimer);
      if (state.fishTimeoutId) clearTimeout(state.fishTimeoutId);
      botStates.delete(roomName);
    }
  }

  log.info({ adminUserId, removed: bots.length }, 'Stress test bots removed');
  return { removed: bots.length };
}
