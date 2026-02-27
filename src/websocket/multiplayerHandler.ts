import type { AuthenticatedSocket } from '../types/socket.js';
import { WS_EVENTS } from './events.js';
import { emitToUser } from './index.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { User } from '../models/User.js';
import { Farm } from '../models/Farm.js';
import { createLogger } from '../config/logger.js';
import { fishService } from '../services/FishService.js';
import { questService } from '../services/QuestService.js';

const log = createLogger('MultiplayerWS');

const MOVE_THROTTLE_MS = 66; // ~15 updates/sec max
const CHAT_MAX_LENGTH = 200;

export function registerMultiplayerHandlers(socket: AuthenticatedSocket): void {
  const { userId } = socket.user;
  let lastMoveTime = 0;

  socket.on(WS_EVENTS.MP_JOIN, async (data: { sceneSlug?: string }) => {
    try {
      const sceneSlug = data?.sceneSlug;
      if (!sceneSlug || typeof sceneSlug !== 'string') {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: 'Invalid scene slug' });
        return;
      }

      const user = await User.findById(userId).lean();
      if (!user) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: 'User not found' });
        return;
      }

      const username = user.username ?? 'Anon';
      const petName = user.pet?.customName ?? user.pet?.name ?? 'Pet';
      const petImageUrl = user.pet?.imageUrl ?? '';
      const petPose = user.pet?.pose;

      const farm = await Farm.findOne({ userId }).select('equipped').lean();
      const equipped = farm?.equipped
        ? {
            ...(farm.equipped.handTool && { handTool: farm.equipped.handTool }),
            ...(farm.equipped.bobber && { bobber: farm.equipped.bobber }),
            ...(farm.equipped.chair && { chair: farm.equipped.chair }),
          }
        : undefined;

      const result = await multiplayerManager.joinScene(userId, sceneSlug, username, petName, petImageUrl, petPose, equipped);

      socket.join(result.roomName);

      socket.emit(WS_EVENTS.MP_JOINED, {
        instanceId: result.instanceId,
        players: result.players,
        spawnX: result.self.x,
        spawnY: result.self.y,
      });

      socket.to(result.roomName).emit(WS_EVENTS.MP_PLAYER_JOINED, {
        userId,
        username,
        petName,
        petImageUrl,
        petPose,
        x: result.self.x,
        y: result.self.y,
        ...(result.self.equippedHandTool && { equippedHandTool: result.self.equippedHandTool }),
        ...(result.self.equippedBobber && { equippedBobber: result.self.equippedBobber }),
        ...(result.self.equippedChair && { equippedChair: result.self.equippedChair }),
      });
    } catch (err: any) {
      log.error({ userId, err: err.message }, 'mp:join failed');
      socket.emit(WS_EVENTS.GAME_ERROR, { message: 'Failed to join scene' });
    }
  });

  socket.on(WS_EVENTS.MP_LEAVE, () => {
    handleLeave();
  });

  socket.on(WS_EVENTS.MP_MOVE, (data: { x?: number; y?: number }) => {
    const now = Date.now();
    if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
    lastMoveTime = now;

    const x = data?.x;
    const y = data?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;

    const result = multiplayerManager.movePlayer(userId, x, y);
    if (!result) return;

    socket.to(result.roomName).emit(WS_EVENTS.MP_PLAYER_MOVED, {
      userId,
      x: result.clampedX,
      y: result.clampedY,
    });
  });

  socket.on(WS_EVENTS.MP_POSE, (data: { pose?: string | null }) => {
    const pose = data?.pose ?? null;
    if (pose !== null && typeof pose !== 'string') return;

    const instance = multiplayerManager.getInstanceForUser(userId);
    if (!instance) return;

    instance.setPose(userId, pose);

    socket.to(instance.roomName).emit(WS_EVENTS.MP_PLAYER_POSE, {
      userId,
      pose,
    });
  });

  socket.on(WS_EVENTS.MP_FISH_CAST, async (data: { sceneSlug?: string; col?: number; row?: number }) => {
    try {
      const sceneSlug = data?.sceneSlug;
      const col = data?.col;
      const row = data?.row;
      if (!sceneSlug || typeof sceneSlug !== 'string' || typeof col !== 'number' || typeof row !== 'number') return;

      const instance = multiplayerManager.getInstanceForUser(userId);
      if (!instance) return;

      const wasFishing = fishService.cancelFishing(userId);
      if (wasFishing) {
        socket.to(instance.roomName).emit(WS_EVENTS.MP_FISH_CANCELED, { userId });
      }

      const valid = await fishService.validateFishingTile(sceneSlug, col, row);
      if (!valid) return;

      const player = instance.getPlayer(userId);
      if (!player) return;

      const userDoc = await User.findById(userId).select('timezone').lean();
      const tz = userDoc?.timezone;

      fishService.scheduleBite(userId, sceneSlug, col, row, async (uid) => {
        const preRoll = await fishService.preRollFish(uid, sceneSlug, col, row, tz);
        emitToUser(uid, WS_EVENTS.MP_FISH_BITE, {
          fishLabel: preRoll?.label,
          fishImageUrl: preRoll?.imageUrl,
          difficulty: preRoll?.difficulty ?? 2,
        });
        socket.to(instance.roomName).emit(WS_EVENTS.MP_FISH_REELING, { userId: uid });
      });

      socket.to(instance.roomName).emit(WS_EVENTS.MP_FISH_STARTED, { userId, col, row });
    } catch (err: any) {
      log.error({ userId, err: err.message }, 'mp:fish_cast failed');
    }
  });

  socket.on(WS_EVENTS.MP_FISH_CANCEL, () => {
    const instance = multiplayerManager.getInstanceForUser(userId);
    const wasFishing = fishService.cancelFishing(userId);
    if (instance && wasFishing) {
      socket.to(instance.roomName).emit(WS_EVENTS.MP_FISH_CANCELED, { userId });
    }
  });

  socket.on(WS_EVENTS.MP_FISH_RESULT, async (data: { passed?: boolean }) => {
    try {
      const passed = data?.passed === true;

      const instance = multiplayerManager.getInstanceForUser(userId);
      if (!instance) return;

      const user = await User.findById(userId).select('timezone').lean();
      const timezone = user?.timezone;

      const outcome = await fishService.completeFishing(userId, passed, timezone);

      const player = instance.getPlayer(userId);
      if (outcome.caught && outcome.result) {
        // Emit state update so the catcher's inventory, gems, and quests refresh (quest canComplete may have changed)
        const [farm, quests] = await Promise.all([
          Farm.findOne({ userId }).select('inventory gems').lean(),
          questService.getQuestsForUser(userId),
        ]);
        const update: Record<string, unknown> = { quests };
        if (farm) {
          const inventoryRecord: Record<string, number> = {};
          const inv = farm.inventory;
          if (inv) {
            const entries = inv instanceof Map ? inv.entries() : Object.entries(inv);
            for (const [k, v] of entries) {
              if (typeof v === 'number' && v > 0) inventoryRecord[k] = v;
            }
          }
          update.inventory = inventoryRecord;
          update.gems = farm.gems ?? 0;
        }
        emitToUser(userId, WS_EVENTS.GAME_STATE_UPDATE, update);
        const payload = {
          userId,
          username: player?.username ?? 'Anon',
          itemType: outcome.result.itemType,
          label: outcome.result.label,
          size: outcome.result.size,
          sizeLabel: outcome.result.sizeLabel,
          rarity: outcome.result.rarity ?? 'common',
          imageUrl: outcome.result.imageUrl,
        };
        socket.nsp.to(instance.roomName).emit(WS_EVENTS.MP_FISH_CAUGHT, payload);
        socket.emit(WS_EVENTS.MP_FISH_CAUGHT, payload);
      } else {
        socket.nsp.to(instance.roomName).emit(WS_EVENTS.MP_FISH_FAILED, { userId });
      }
    } catch (err: any) {
      log.error({ userId, err: err.message }, 'mp:fish_result failed');
    }
  });

  socket.on(WS_EVENTS.MP_CHAT, (data: { text?: string }) => {
    const text = data?.text;
    if (!text || typeof text !== 'string') return;

    const sanitized = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (sanitized.length === 0) return;

    const instance = multiplayerManager.getInstanceForUser(userId);
    if (!instance) return;

    const player = instance.getPlayer(userId);
    if (!player) return;

    const io = socket.nsp;
    io.to(instance.roomName).emit(WS_EVENTS.MP_CHAT_MESSAGE, {
      userId,
      username: player.username,
      text: sanitized,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    handleLeave();
  });

  function handleLeave(): void {
    const wasFishing = fishService.cancelFishing(userId);
    const result = multiplayerManager.leaveScene(userId);
    if (!result) return;
    socket.leave(result.roomName);
    socket.to(result.roomName).emit(WS_EVENTS.MP_PLAYER_LEFT, { userId });
    if (wasFishing) socket.to(result.roomName).emit(WS_EVENTS.MP_FISH_CANCELED, { userId });
  }
}
