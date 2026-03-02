import type { AuthenticatedSocket } from '../types/socket.js';
import { WS_EVENTS } from './events.js';
import { farmService, type StateUpdate } from '../services/FarmService.js';
import { questService } from '../services/QuestService.js';
import { bugService, BUG_LIFESPAN_MS } from '../services/BugService.js';
import { balloonService, BALLOON_LIFESPAN_MS } from '../services/BalloonService.js';
import { spawnScheduler } from '../services/SpawnScheduler.js';
import { cookingService, type CookInput } from '../services/CookingService.js';
import { craftingService, type CraftInput } from '../services/CraftingService.js';
import { collectWater, getWellCooldown } from '../services/WellService.js';
import { User } from '../models/User.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';
import { petBehaviorStore } from '../services/PetBehaviorStore.js';
import * as petAIService from '../services/PetAIService.js';
import type { PetStateUpdatePayload } from '../services/PetAIService.js';
import { digFossil } from '../services/FossilService.js';
import { shakeTree } from '../services/TreeService.js';
import { findAdjacentWalkableForItem } from '../services/PetTargeting.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { getIO } from './index.js';

const log = createLogger('GameWS');

/** Duration pet plays dig animation before returning to idle (ms). */
const PET_DIGGING_DURATION_MS = 1_800;

/**
 * Registers all game-related WebSocket event listeners on an authenticated socket.
 *
 * Each handler:
 * 1. Extracts userId from the authenticated socket
 * 2. Calls the appropriate FarmService method
 * 3. Emits the result back to the caller
 * 4. On error, emits game:error with a message
 */
export function registerGameHandlers(socket: AuthenticatedSocket): void {
  const { userId } = socket.user;

  // ─── User timezone (for time-of-day bug filtering) ──────────────────────

  let userTimezone: string | undefined;

  socket.on(WS_EVENTS.USER_SET_TIMEZONE, async (data: { timezone?: string }) => {
    if (!data?.timezone || typeof data.timezone !== 'string') return;
    userTimezone = data.timezone;
    try {
      await User.updateOne({ _id: userId }, { $set: { timezone: data.timezone } });
    } catch (err: any) {
      log.warn({ userId, err: err.message }, 'Failed to persist timezone');
    }
  });

  /** Schedule periodic bug spawn attempts. */
  function scheduleBugSpawn(): void {
    spawnScheduler.schedule(userId, 'bug', () => bugService.getSpawnDelay(), async () => {
      const bug = await bugService.spawnBug(userId, userTimezone, 'farm');
      if (bug) {
        socket.emit(WS_EVENTS.BUG_SPAWN, {
          spawnId: bug.spawnId,
          itemType: bug.itemType,
          col: bug.col,
          row: bug.row,
          spawnedAt: bug.spawnedAt,
          ...(bug.hostPlacedItemId && { hostPlacedItemId: bug.hostPlacedItemId }),
        });
        setTimeout(() => {
          if (bugService.removeBug(userId, bug.spawnId)) {
            socket.emit(WS_EVENTS.BUG_DESPAWN, { spawnId: bug.spawnId });
          }
        }, BUG_LIFESPAN_MS);
      }
    });
  }

  /** Schedule periodic balloon spawn attempts. */
  function scheduleBalloonSpawn(): void {
    spawnScheduler.schedule(userId, 'balloon', () => balloonService.getSpawnDelay(), async () => {
      const balloon = await balloonService.spawnBalloon(userId);
      if (balloon) {
        socket.emit(WS_EVENTS.BALLOON_SPAWN, {
          spawnId: balloon.spawnId,
          itemType: balloon.itemType,
          col: balloon.col,
          row: balloon.row,
          spawnedAt: balloon.spawnedAt,
        });
        setTimeout(() => {
          if (balloonService.removeBalloon(userId, balloon.spawnId)) {
            socket.emit(WS_EVENTS.BALLOON_DESPAWN, { spawnId: balloon.spawnId });
          }
        }, BALLOON_LIFESPAN_MS);
      }
    });
  }

  /** Emit a state update and, if any quests auto-completed, emit quest:completed for each. */
  function emitStateUpdate(update: StateUpdate | Record<string, any>): void {
    const autoCompleted = (update as StateUpdate).autoCompletedQuests;
    if (autoCompleted?.length) {
      // Strip from the state update payload (client handles via quest:completed)
      const { autoCompletedQuests: _, ...cleanUpdate } = update as StateUpdate;
      socket.emit(WS_EVENTS.GAME_STATE_UPDATE, cleanUpdate);
      for (const ac of autoCompleted) {
        const payload: Record<string, unknown> = { questId: ac.questId };
        if (ac.endDialog) payload.endDialog = ac.endDialog;
        if (ac.rewards) payload.rewards = ac.rewards;
        if (ac.nextQuestId) payload.nextQuestId = ac.nextQuestId;
        if (ac.nextQuestStartDialog) payload.nextQuestStartDialog = ac.nextQuestStartDialog;
        socket.emit(WS_EVENTS.QUEST_COMPLETED, payload);
      }
    } else {
      socket.emit(WS_EVENTS.GAME_STATE_UPDATE, update);
    }
  }

  // ── Load full game state ────────────────────────────────────────────────

  socket.on(WS_EVENTS.GAME_LOAD, async () => {
    try {
      // Load persisted timezone for bug spawning
      const user = await User.findById(userId).select('timezone').lean();
      if (user?.timezone) userTimezone = user.timezone;

      // Snapshot now includes pendingDialogs atomically (no separate quest:dialog race)
      const snapshot = await farmService.getSnapshot(userId);
      socket.emit(WS_EVENTS.GAME_SNAPSHOT, snapshot);
      log.info({ userId }, 'Snapshot sent');
      scheduleBugSpawn();
      scheduleBalloonSpawn();
      petAIService.schedule(userId, (payload) =>
        socket.emit(WS_EVENTS.PET_STATE_UPDATE, payload),
      );
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to load game' });
      log.error({ userId, err: err.message }, 'game:load failed');
    }
  });

  // ── Place item ──────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_PLACE_ITEM,
    async (data: { itemType: string; col: number; row: number }) => {
      try {
        if (!data?.itemType || data.col == null || data.row == null) {
          throw new Error('Missing itemType, col, or row');
        }
        const update = await farmService.placeItem(userId, data.itemType, data.col, data.row);
        emitStateUpdate(update);
        if (update.pet) {
          socket.emit(WS_EVENTS.PET_UPDATED, { pet: update.pet });
        }
        const def = await GameItemDef.findOne({ itemType: data.itemType }).lean();
        if (def?.category === 'decoration') {
          await petAIService.reactToDecoration(
            userId,
            data.col,
            data.row,
            data.itemType,
            (payload) => socket.emit(WS_EVENTS.PET_STATE_UPDATE, payload),
          );
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to place item' });
        log.warn({ userId, data, err: err.message }, 'game:place_item failed');
      }
    },
  );

  // ── Remove item ─────────────────────────────────────────────────────────

  socket.on(WS_EVENTS.GAME_REMOVE_ITEM, async (data: { itemId?: string; anchorId?: string }) => {
    try {
      const itemId = data?.itemId ?? data?.anchorId;
      if (!itemId) throw new Error('Missing itemId or anchorId');
      const update = await farmService.removeItem(userId, itemId);
      emitStateUpdate(update);
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to remove item' });
      log.warn({ userId, data, err: err.message }, 'game:remove_item failed');
    }
  });

  // ── Harvest crop ────────────────────────────────────────────────────────

  socket.on(WS_EVENTS.GAME_HARVEST, async (data: { itemId: string }) => {
    try {
      if (!data?.itemId) throw new Error('Missing itemId');
      const update = await farmService.harvestCrop(userId, data.itemId);
      emitStateUpdate(update);
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to harvest' });
      log.warn({ userId, data, err: err.message }, 'game:harvest failed');
    }
  });

  socket.on(WS_EVENTS.GAME_SHAKE_TREE, async (data: { anchorId: string }) => {
    try {
      if (!data?.anchorId) throw new Error('Missing anchorId');
      const result = await shakeTree(userId, data.anchorId);
      if (result) {
        emitStateUpdate(result.stateUpdate);
      }
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to shake tree' });
      log.warn({ userId, data, err: err.message }, 'game:shake_tree failed');
    }
  });

  // ── Rename farm ─────────────────────────────────────────────────────────

  socket.on(WS_EVENTS.GAME_RENAME_FARM, async (data: { name: string }) => {
    try {
      if (!data?.name) throw new Error('Missing name');
      const update = await farmService.renameFarm(userId, data.name);
      emitStateUpdate(update);
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to rename farm' });
      log.warn({ userId, data, err: err.message }, 'game:rename_farm failed');
    }
  });

  // ── Move item ──────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_MOVE_ITEM,
    async (data: { itemId: string; col: number; row: number }) => {
      try {
        if (!data?.itemId || data.col == null || data.row == null) {
          throw new Error('Missing itemId, col, or row');
        }
        const update = await farmService.moveItem(userId, data.itemId, data.col, data.row);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to move item' });
        log.warn({ userId, data, err: err.message }, 'game:move_item failed');
      }
    },
  );

  // ── Water tile ────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_WATER_TILE,
    async (data: { col: number; row: number }) => {
      try {
        if (data.col == null || data.row == null) throw new Error('Missing col or row');
        const update = await farmService.waterTile(userId, data.col, data.row);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to water tile' });
        log.warn({ userId, data, err: err.message }, 'game:water_tile failed');
      }
    },
  );

  // ── Batch crop operations (plant/water/harvest) ────────────────────────

  socket.on(
    WS_EVENTS.GAME_CROP_BATCH,
    async (data: { ops: Array<{ type: string; itemType?: string; col?: number; row?: number; anchorId?: string }> }) => {
      try {
        if (!data?.ops?.length) throw new Error('Missing ops');
        const update = await farmService.cropBatch(userId, data.ops as any);
        emitStateUpdate(update);
        if (update.pet) {
          socket.emit(WS_EVENTS.PET_UPDATED, { pet: update.pet });
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Crop batch failed' });
        log.warn({ userId, opCount: data?.ops?.length, err: err.message }, 'game:crop_batch failed');
      }
    },
  );

  // ── Purchase item from shop ──────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_PURCHASE,
    async (data: { itemType: string }) => {
      try {
        if (!data?.itemType) throw new Error('Missing itemType');
        const update = await farmService.purchaseItem(userId, data.itemType);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to purchase item' });
        log.warn({ userId, data, err: err.message }, 'game:purchase failed');
      }
    },
  );

  // ── Sell item to shop ─────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_SELL,
    async (data: { itemType: string; qty?: number }) => {
      try {
        if (!data?.itemType) throw new Error('Missing itemType');
        const qty = Math.max(1, data.qty ?? 1);
        const update = await farmService.sellItem(userId, data.itemType, qty);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to sell item' });
        log.warn({ userId, data, err: err.message }, 'game:sell failed');
      }
    },
  );

  socket.on(
    WS_EVENTS.GAME_SELL_BATCH,
    async (data: { items: Array<{ itemType: string; qty: number }> }) => {
      try {
        if (!Array.isArray(data?.items) || data.items.length === 0) return;
        const items = data.items
          .filter((i) => i?.itemType && i?.qty > 0)
          .map((i) => ({ itemType: i.itemType, qty: Math.max(1, i.qty) }));
        if (items.length === 0) return;
        const update = await farmService.sellItemsBatch(userId, items);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to sell items' });
        log.warn({ userId, data, err: err.message }, 'game:sell_batch failed');
      }
    },
  );

  // ── Set equipped item ─────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_SET_EQUIPPED,
    async (data: { slot: 'handTool' | 'bobber' | 'bait' | 'chair'; itemType: string | null }) => {
      try {
        if (!data?.slot || !['handTool', 'bobber', 'bait', 'chair'].includes(data.slot)) {
          throw new Error('Invalid slot');
        }
        const update = await farmService.setEquipped(
          userId,
          data.slot,
          data.itemType ?? null,
        );
        const questsAfterEquip = await questService.advanceStepIfMet(userId);
        if (questsAfterEquip) {
          emitStateUpdate({ ...update, quests: questsAfterEquip });
        } else {
          emitStateUpdate(update);
        }
        // Broadcast equipment change to multiplayer room so other players see it (bait not shown on avatar)
        const instance = multiplayerManager.getInstanceForUser(userId);
        const mpSlot = data.slot === 'handTool' || data.slot === 'bobber' || data.slot === 'chair' ? data.slot : null;
        if (instance && mpSlot) {
          multiplayerManager.updatePlayerEquipped(userId, mpSlot, data.itemType ?? null);
          const slotToKey = { handTool: 'equippedHandTool', bobber: 'equippedBobber', chair: 'equippedChair' } as const;
          const key = slotToKey[mpSlot];
          getIO().to(instance.roomName).emit(WS_EVENTS.MP_PLAYER_EQUIPPED, {
            userId,
            [key]: data.itemType ?? null,
          });
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to equip' });
        log.warn({ userId, data, err: err.message }, 'game:set_equipped failed');
      }
    },
  );

  // ── Pop balloon ───────────────────────────────────────────────────────

  socket.on(WS_EVENTS.BALLOON_POP, async (data: { spawnId: string }) => {
    try {
      if (!data?.spawnId) throw new Error('Missing spawnId');
      const result = await balloonService.popBalloon(userId, data.spawnId);
      if (!result) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: 'Balloon already gone!' });
        return;
      }
      socket.emit(WS_EVENTS.BALLOON_POPPED, result.popResult);
      emitStateUpdate(result.stateUpdate);
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to pop balloon' });
      log.warn({ userId, data, err: err.message }, 'balloon:pop failed');
    }
  });

  // ── Catch bug with net tool ───────────────────────────────────────────

  socket.on(WS_EVENTS.BUG_CATCH, async (data: { spawnId: string }) => {
    try {
      if (!data?.spawnId) throw new Error('Missing spawnId');
      const result = await bugService.catchBug(userId, data.spawnId);
      if (!result) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: 'Bug already gone!', spawnId: data.spawnId });
        return;
      }
      socket.emit(WS_EVENTS.BUG_CAUGHT, result.catchResult);
      emitStateUpdate(result.stateUpdate);
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to catch bug' });
      log.warn({ userId, data, err: err.message }, 'bug:catch failed');
    }
  });

  // ── Complete quest ───────────────────────────────────────────────────

  socket.on(WS_EVENTS.QUEST_COMPLETE, async (data: { questId: string }) => {
    try {
      if (!data?.questId) throw new Error('Missing questId');
      const result = await questService.completeQuest(userId, data.questId);

      // Always include farmLevel in QUEST_COMPLETED so client can update immediately
      const farm = await farmService.loadOrCreateFarm(userId);
      const level = await farmService.resolveFarmLevel(userId, farm.xp);

      const completedPayload: Record<string, unknown> = {
        questId: data.questId,
        farmLevel: level.level,
        inventory: result.inventory,
        gems: result.gems,
        quests: await questService.getQuestsForUser(userId),
      };
      if (result.newFarmLevel) completedPayload.newFarmLevel = result.newFarmLevel;
      if (result.endDialog) completedPayload.endDialog = result.endDialog;
      if (result.rewards) completedPayload.rewards = result.rewards;
      if (result.nextQuestId) completedPayload.nextQuestId = result.nextQuestId;
      if (result.nextQuestStartDialog) completedPayload.nextQuestStartDialog = result.nextQuestStartDialog;

      socket.emit(WS_EVENTS.QUEST_COMPLETED, completedPayload);

      // For farm upgrades, send a full snapshot so the client gets the new grid size
      if (result.newFarmLevel) {
        const snapshot = await farmService.getSnapshot(userId);
        socket.emit(WS_EVENTS.GAME_SNAPSHOT, snapshot);
      } else {
        socket.emit(WS_EVENTS.GAME_STATE_UPDATE, {
          farmXp: result.farmXp,
          gems: result.gems,
          farmLevel: level.level,
          inventory: result.inventory,
          quests: completedPayload.quests,
        });
      }
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to complete quest' });
      log.warn({ userId, data, err: err.message }, 'quest:complete failed');
    }
  });

  // ── Activate quest by NPC ───────────────────────────────────────────

  socket.on(WS_EVENTS.QUEST_ACTIVATE_BY_NPC, async (data: { npcItemType: string }) => {
    try {
      if (!data?.npcItemType) return;
      log.info({ userId, npcItemType: data.npcItemType }, 'quest:activate_by_npc received');
      const [user, farm] = await Promise.all([
        User.findById(userId).select('pet').lean(),
        farmService.loadOrCreateFarm(userId),
      ]);
      const petLevel = user?.pet?.level ?? 1;
      const farmLevel = (await farmService.resolveFarmLevel(userId, farm.xp)).level;
      const result = await questService.tryActivateByTrigger(
        userId,
        'talk_to_npc',
        { npcItemType: data.npcItemType },
        { petLevel, farmLevel },
      );
      socket.emit(WS_EVENTS.QUEST_ACTIVATED, {
        activated: result.activated,
        quests: result.quests,
      });
      if (result.activated.length > 0 && !result.autoCompletedQuests?.length) {
        socket.emit(WS_EVENTS.GAME_STATE_UPDATE, { quests: result.quests });
      }
      if (result.autoCompletedQuests?.length) {
        const freshFarm = await farmService.loadOrCreateFarm(userId);
        const lvl = await farmService.resolveFarmLevel(userId, freshFarm.xp);
        const inv: Record<string, number> = {};
        for (const [k, v] of freshFarm.inventory) {
          if (v > 0) inv[k] = v;
        }
        emitStateUpdate({
          quests: result.quests,
          inventory: inv,
          gems: freshFarm.gems,
          farmLevel: lvl.level,
          autoCompletedQuests: result.autoCompletedQuests,
        });
      }
    } catch (err: any) {
      log.warn({ userId, data, err: err.message }, 'quest:activate_by_npc failed');
    }
  });

  // ── Activate quest by scene ─────────────────────────────────────────

  socket.on(WS_EVENTS.QUEST_ACTIVATE_BY_SCENE, async (data: { sceneSlug: string }) => {
    try {
      if (!data?.sceneSlug) return;
      const [user, farm] = await Promise.all([
        User.findById(userId).select('pet').lean(),
        farmService.loadOrCreateFarm(userId),
      ]);
      const petLevel = user?.pet?.level ?? 1;
      const farmLevel = (await farmService.resolveFarmLevel(userId, farm.xp)).level;
      const result = await questService.tryActivateByTrigger(
        userId,
        'enter_scene',
        { sceneSlug: data.sceneSlug },
        { petLevel, farmLevel },
      );
      socket.emit(WS_EVENTS.QUEST_ACTIVATED, {
        activated: result.activated,
        quests: result.quests,
      });
      if (result.activated.length > 0) {
        socket.emit(WS_EVENTS.GAME_STATE_UPDATE, { quests: result.quests });
      }
    } catch (err: any) {
      log.warn({ userId, data, err: err.message }, 'quest:activate_by_scene failed');
    }
  });

  socket.on(WS_EVENTS.QUEST_NPC_DIALOG_DISMISSED, async (data: { npcItemType: string }) => {
    try {
      if (!data?.npcItemType) return;
      const quests = await questService.trackNpcTalk(userId, data.npcItemType);
      if (quests) socket.emit(WS_EVENTS.GAME_STATE_UPDATE, { quests });
    } catch (err: any) {
      log.warn({ userId, data, err: err.message }, 'quest:npc_dialog_dismissed failed');
    }
  });

  socket.on(WS_EVENTS.QUEST_MODAL_OPENED, async (data: { payload: string }) => {
    try {
      if (!data?.payload) return;
      const quests = await questService.trackModalOpened(userId, data.payload);
      if (quests) socket.emit(WS_EVENTS.GAME_STATE_UPDATE, { quests });
    } catch (err: any) {
      log.warn({ userId, data, err: err.message }, 'quest:modal_opened failed');
    }
  });

  // ── Cook ────────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_COOK,
    async (data: { ingredients: CookInput[]; minigamePassed: boolean }) => {
      try {
        if (!data?.ingredients?.length) throw new Error('Missing ingredients');
        const result = await cookingService.attemptCook(userId, data.ingredients, data.minigamePassed);
        socket.emit(WS_EVENTS.GAME_COOK_RESULT, {
          matched: result.matched,
          resultItemType: result.resultItemType,
          resultQty: result.resultQty,
          isNewDiscovery: result.isNewDiscovery,
          recipeId: result.recipeId,
          recipeLabel: result.recipeLabel,
          recipeImageUrl: result.recipeImageUrl,
        });
        emitStateUpdate({
          inventory: result.inventory,
          farmXp: result.farmXp,
          gems: result.gems,
        });
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to cook' });
        log.warn({ userId, data, err: err.message }, 'game:cook failed');
      }
    },
  );

  // ── Collect water from well ──────────────────────────────────────────

  socket.on(WS_EVENTS.GAME_COLLECT_WATER, async (data: { wellSlug?: string }) => {
    try {
      const wellSlug = (data?.wellSlug ?? 'well').trim();
      const result = await collectWater(userId, wellSlug);
      if (!result) {
        const nextAt = await getWellCooldown(userId);
        socket.emit(WS_EVENTS.GAME_COLLECT_WATER_RESULT, {
          success: false,
          onCooldown: true,
          message: 'Well is refilling. Try again in a few minutes.',
          ...(nextAt && { nextAvailableAt: nextAt.toISOString() }),
        });
        return;
      }
      emitStateUpdate({ inventory: result.inventory });
      socket.emit(WS_EVENTS.GAME_COLLECT_WATER_RESULT, {
        success: true,
        waterQty: result.waterQty,
        nextAvailableAt: result.nextAvailableAt.toISOString(),
      });
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to collect water' });
      log.warn({ userId, err: err.message }, 'game:collect_water failed');
    }
  });

  // ── Craft ────────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_CRAFT,
    async (data: { ingredients: CraftInput[]; minigamePassed: boolean }) => {
      try {
        if (!data?.ingredients?.length) throw new Error('Missing ingredients');
        const result = await craftingService.attemptCraft(userId, data.ingredients, data.minigamePassed);
        socket.emit(WS_EVENTS.GAME_CRAFT_RESULT, {
          matched: result.matched,
          resultItemType: result.resultItemType,
          resultQty: result.resultQty,
          isNewDiscovery: result.isNewDiscovery,
          recipeId: result.recipeId,
          recipeLabel: result.recipeLabel,
        });
        emitStateUpdate({
          inventory: result.inventory,
          farmXp: result.farmXp,
          gems: result.gems,
        });
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to craft' });
        log.warn({ userId, data, err: err.message }, 'game:craft failed');
      }
    },
  );

  // ── Pet behavior (client reports; server validates and can force correct) ─

  socket.on(WS_EVENTS.PET_BEHAVIOR, (data: { state?: string }) => {
    const state = data?.state;
    const valid = ['idle', 'walking', 'sleepy', 'sleeping', 'eating', 'admiring'] as const;
    if (!state || !valid.includes(state as (typeof valid)[number])) return;
    petBehaviorStore.set(userId, state as Parameters<typeof petBehaviorStore.set>[1]);
  });

  /** Client signals walk/eat animation done; server advances to next state. */
  socket.on(
    WS_EVENTS.PET_ACTION_COMPLETE,
    async (data: { targetCol?: number; targetRow?: number }) => {
      const { targetCol, targetRow } = data ?? {};
      if (targetCol == null || targetRow == null) return;
      const payload = petAIService.handleActionComplete(userId, targetCol, targetRow);
      if (payload) {
        if (payload.behavior === 'digging' && payload.interactionTarget) {
          const result = await digFossil(userId, payload.interactionTarget);
          if (result) {
            emitStateUpdate(result.stateUpdate);
            socket.emit(WS_EVENTS.PET_STATE_UPDATE, {
              col: payload.col,
              row: payload.row,
              behavior: 'digging',
              interactionTarget: payload.interactionTarget,
            });
            setTimeout(() => {
              petBehaviorStore.setFull(userId, 'idle', payload.col, payload.row);
              socket.emit(WS_EVENTS.PET_STATE_UPDATE, {
                col: payload.col,
                row: payload.row,
                behavior: 'idle',
              });
              // Emit fossil reward after dig animation completes
              socket.emit(WS_EVENTS.FOSSIL_DUG, result.result);
            }, PET_DIGGING_DURATION_MS);
          } else {
            socket.emit(WS_EVENTS.PET_STATE_UPDATE, {
              col: payload.col,
              row: payload.row,
              behavior: 'idle',
            });
          }
        } else {
          socket.emit(WS_EVENTS.PET_STATE_UPDATE, payload);
        }
      }
    },
  );

  // ── Fossil dig ─────────────────────────────────────────────────────────

  socket.on(WS_EVENTS.FOSSIL_DIG, async (data: { anchorId?: string }) => {
    try {
      const anchorId = data?.anchorId;
      if (!anchorId || typeof anchorId !== 'string') {
        throw new Error('Missing anchorId');
      }
      const farmData = await farmService.getFarmDataForPetAI(userId);
      const farm = await farmService.loadOrCreateFarm(userId);
      const handTool = farm.equipped?.handTool;
      const isShovel =
        handTool &&
        (farmData.itemDefs[handTool]?.subCategory === 'shovel' ||
          farmData.itemDefs[handTool]?.subCategory === 'shovels');
      if (!isShovel) {
        throw new Error('Shovel required to dig');
      }
      const fossil = farmData.placedItems.find(
        (i) => i.id === anchorId || i.anchorId === anchorId,
      );
      if (!fossil) {
        throw new Error('Fossil not found');
      }
      const def = farmData.itemDefs[fossil.itemType];
      const isDiggable =
        fossil.itemType === 'fossil_hole' || def?.subCategory === 'dig_hole';
      if (!isDiggable) {
        throw new Error('Item is not diggable');
      }
      const target = findAdjacentWalkableForItem(
        fossil,
        farmData.placedItems,
        farmData.itemDefs,
        farmData.gridCols,
        farmData.gridRows,
      );
      if (!target) {
        throw new Error('No adjacent walkable tile to dig from');
      }
      const entry = petBehaviorStore.get(userId);
      const curCol = entry?.col ?? farmData.petSpawnCol;
      const curRow = entry?.row ?? farmData.petSpawnRow;
      const emit = (payload: PetStateUpdatePayload) =>
        socket.emit(WS_EVENTS.PET_STATE_UPDATE, payload);
      petAIService.initiateDigWalk(
        userId,
        anchorId,
        target.col,
        target.row,
        curCol,
        curRow,
        emit,
      );
    } catch (err: any) {
      socket.emit(WS_EVENTS.GAME_ERROR, {
        message: err.message ?? 'Failed to dig fossil',
      });
      log.warn({ userId, data, err: err.message }, 'fossil:dig failed');
    }
  });

  /** Runs every 5s; if pet stuck in sleep/eat/walk, force idle and push to client. */
  const validateInterval = setInterval(() => {
    const correct = petBehaviorStore.validateAndCorrect(userId);
    if (correct) {
      const entry = petBehaviorStore.get(userId);
      if (entry) {
        socket.emit(WS_EVENTS.PET_STATE_UPDATE, {
          col: entry.col,
          row: entry.row,
          behavior: 'idle',
        });
      } else {
        socket.emit(WS_EVENTS.PET_BEHAVIOR_SYNC, { state: correct });
      }
    }
  }, 5_000);

  // ── Feed pet (placed food consumed) ──────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_FEED_PET,
    async (data: { anchorId: string; foodItemType: string }) => {
      try {
        if (!data?.anchorId || !data?.foodItemType) throw new Error('Missing anchorId or foodItemType');
        const removeUpdate = await farmService.removeItem(userId, data.anchorId, { consume: true });
        const feedResult = await cookingService.feedPet(userId, data.foodItemType);
        emitStateUpdate(removeUpdate);
        if (feedResult.pet) {
          socket.emit(WS_EVENTS.PET_UPDATED, { pet: feedResult.pet });
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to feed pet' });
        log.warn({ userId, data, err: err.message }, 'game:feed_pet failed');
      }
    },
  );

  // ── Food dish ────────────────────────────────────────────────────────

  socket.on(
    WS_EVENTS.GAME_ADD_TO_FOOD_DISH,
    async (data: { anchorId: string; items: Array<{ itemType: string; qty: number }> }) => {
      try {
        if (!data?.anchorId || !Array.isArray(data.items) || data.items.length === 0) {
          throw new Error('Missing anchorId or items');
        }
        const update = await farmService.addToFoodDish(userId, data.anchorId, data.items);
        emitStateUpdate(update);
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to add to food dish' });
        log.warn({ userId, data, err: err.message }, 'game:add_to_food_dish failed');
      }
    },
  );

  socket.on(
    WS_EVENTS.GAME_CONSUME_FROM_FOOD_DISH,
    async (data: { anchorId: string }) => {
      try {
        if (!data?.anchorId) throw new Error('Missing anchorId');
        const consumed = await farmService.consumeFromFoodDish(userId, data.anchorId);
        if (!consumed) {
          socket.emit(WS_EVENTS.GAME_ERROR, { message: 'Food dish is empty' });
          return;
        }
        const feedResult = await cookingService.feedPet(userId, consumed.itemType);
        emitStateUpdate(consumed.update);
        if (feedResult.pet) {
          socket.emit(WS_EVENTS.PET_UPDATED, { pet: feedResult.pet });
        }
      } catch (err: any) {
        socket.emit(WS_EVENTS.GAME_ERROR, { message: err.message ?? 'Failed to consume from food dish' });
        log.warn({ userId, data, err: err.message }, 'game:consume_from_food_dish failed');
      }
    },
  );

  // ── Cleanup on disconnect ─────────────────────────────────────────────

  socket.on('disconnect', () => {
    clearInterval(validateInterval);
    spawnScheduler.cancelUser(userId);
    bugService.clearBugs(userId);
    balloonService.clearBalloons(userId);
    petAIService.cancel(userId);
    petBehaviorStore.remove(userId);
  });
}
