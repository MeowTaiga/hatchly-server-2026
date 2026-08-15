import type { AuthenticatedSocket } from '../types/socket.js';
import { WS_EVENTS } from './events.js';
import { emitToUser } from './index.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { User } from '../models/User.js';
import { Farm } from '../models/Farm.js';
import { createLogger } from '../config/logger.js';
import { fishService } from '../services/FishService.js';
import { assertCanEnterScene } from '../services/SceneAccessService.js';
import { tradeService, type TradeOfferItem } from '../services/TradeService.js';

const log = createLogger('MultiplayerWS');

function emitTradeSnapshots(tradeId: string): void {
  const session = tradeService.getSession(tradeId);
  if (!session) return;
  for (const uid of [session.initiatorUserId, session.recipientUserId]) {
    const snap = tradeService.snapshotFor(tradeId, uid);
    if (snap) emitToUser(uid, WS_EVENTS.MP_TRADE_STATE, snap);
  }
}

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

      try {
        await assertCanEnterScene(userId, sceneSlug);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Cannot enter that scene yet' });
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

      // Include fishing state for players already in the instance so joiner sees existing bobbers
      const fishingState = fishService.getFishingStateForScene(sceneSlug);
      const instanceUserIds = new Set(result.players.map((p) => p.userId));
      const fishingByUser: Record<string, { col: number; row: number; isReeling: boolean }> = {};
      for (const [uid, state] of fishingState) {
        if (instanceUserIds.has(uid)) {
          fishingByUser[uid] = state;
        }
      }

      socket.emit(WS_EVENTS.MP_JOINED, {
        instanceId: result.instanceId,
        players: result.players,
        spawnX: result.self.x,
        spawnY: result.self.y,
        ...(Object.keys(fishingByUser).length > 0 && { fishingByUser }),
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
        // The catch already reconciled quests, so forward that state as-is.
        emitToUser(userId, WS_EVENTS.GAME_STATE_UPDATE, outcome.stateUpdate);
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

  // ── Trade ─────────────────────────────────────────────────────────────

  socket.on(WS_EVENTS.MP_TRADE_REQUEST, async (data: { targetUserId?: string }) => {
    try {
      const targetUserId = data?.targetUserId;
      if (!targetUserId || typeof targetUserId !== 'string') {
        socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: 'Missing target player' });
        return;
      }
      const result = await tradeService.requestTrade(userId, targetUserId);
      emitToUser(targetUserId, WS_EVENTS.MP_TRADE_REQUESTED, {
        tradeId: result.tradeId,
        fromUserId: result.initiator.userId,
        fromUsername: result.initiator.username,
        fromPetName: result.initiator.petName,
        fromPetImageUrl: result.initiator.petImageUrl,
      });
      socket.emit(WS_EVENTS.MP_TRADE_STATE, {
        tradeId: result.tradeId,
        status: 'pending',
        version: 1,
        youUserId: userId,
        partner: result.recipient,
        yourOffer: [],
        theirOffer: [],
        youReady: false,
        theyReady: false,
        waitingForAccept: true,
      });
    } catch (err: any) {
      socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Trade request failed' });
      log.warn({ userId, err: err.message }, 'mp:trade_request failed');
    }
  });

  socket.on(WS_EVENTS.MP_TRADE_ACCEPT, async (data: { tradeId?: string }) => {
    try {
      const tradeId = data?.tradeId;
      if (!tradeId) throw new Error('Missing tradeId');
      const session = await tradeService.acceptTrade(userId, tradeId);
      for (const uid of [session.initiatorUserId, session.recipientUserId]) {
        const snap = tradeService.snapshotFor(tradeId, uid);
        if (snap) emitToUser(uid, WS_EVENTS.MP_TRADE_OPEN, snap);
      }
    } catch (err: any) {
      socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Could not accept trade' });
    }
  });

  socket.on(WS_EVENTS.MP_TRADE_DECLINE, async (data: { tradeId?: string }) => {
    try {
      const tradeId = data?.tradeId;
      if (!tradeId) throw new Error('Missing tradeId');
      const result = await tradeService.declineTrade(userId, tradeId);
      emitToUser(result.initiatorUserId, WS_EVENTS.MP_TRADE_DECLINED, {
        tradeId,
        byUserId: userId,
      });
      socket.emit(WS_EVENTS.MP_TRADE_CANCELLED, { tradeId, reason: 'declined' });
    } catch (err: any) {
      socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Could not decline trade' });
    }
  });

  socket.on(
    WS_EVENTS.MP_TRADE_UPDATE,
    async (data: { tradeId?: string; items?: TradeOfferItem[] }) => {
      try {
        const tradeId = data?.tradeId;
        if (!tradeId) throw new Error('Missing tradeId');
        const items = Array.isArray(data?.items) ? data.items : [];
        const { inventory } = await tradeService.updateOffer(userId, tradeId, items);
        emitToUser(userId, WS_EVENTS.GAME_STATE_UPDATE, { inventory });
        emitTradeSnapshots(tradeId);
      } catch (err: any) {
        socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Could not update offer' });
      }
    },
  );

  socket.on(
    WS_EVENTS.MP_TRADE_CONFIRM,
    async (data: { tradeId?: string; version?: number }) => {
      try {
        const tradeId = data?.tradeId;
        const version = data?.version;
        if (!tradeId || typeof version !== 'number') throw new Error('Missing tradeId/version');
        const result = await tradeService.confirm(userId, tradeId, version);
        if (result.kind === 'waiting') {
          emitTradeSnapshots(tradeId);
          return;
        }
        const { session, inventories } = result;
        for (const uid of [session.initiatorUserId, session.recipientUserId]) {
          const inv = inventories[uid];
          if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
          emitToUser(uid, WS_EVENTS.MP_TRADE_COMPLETE, {
            tradeId,
            partnerUserId:
              uid === session.initiatorUserId
                ? session.recipientUserId
                : session.initiatorUserId,
          });
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Could not confirm trade' });
      }
    },
  );

  socket.on(WS_EVENTS.MP_TRADE_CANCEL, async (data: { tradeId?: string }) => {
    try {
      const tradeId = data?.tradeId;
      if (!tradeId) throw new Error('Missing tradeId');
      const result = await tradeService.cancelTrade(tradeId, userId);
      if (!result) return;
      for (const uid of [result.initiatorUserId, result.recipientUserId]) {
        const inv = result.inventories[uid];
        if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
        emitToUser(uid, WS_EVENTS.MP_TRADE_CANCELLED, {
          tradeId,
          reason: uid === userId ? 'You cancelled the trade' : 'Trade cancelled',
        });
      }
    } catch (err: any) {
      socket.emit(WS_EVENTS.MP_TRADE_ERROR, { message: err.message ?? 'Could not cancel trade' });
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
    void tradeService.cancelForUser(userId).then((cancelled) => {
      if (!cancelled) return;
      for (const uid of [cancelled.initiatorUserId, cancelled.recipientUserId]) {
        const inv = cancelled.inventories[uid];
        if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
        emitToUser(uid, WS_EVENTS.MP_TRADE_CANCELLED, {
          tradeId: cancelled.tradeId,
          reason: 'Player left the area',
        });
      }
    });
    const result = multiplayerManager.leaveScene(userId);
    if (!result) return;
    socket.leave(result.roomName);
    socket.to(result.roomName).emit(WS_EVENTS.MP_PLAYER_LEFT, { userId });
    if (wasFishing) socket.to(result.roomName).emit(WS_EVENTS.MP_FISH_CANCELED, { userId });
  }
}
