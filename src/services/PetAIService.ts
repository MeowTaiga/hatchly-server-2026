/**
 * Backend Pet AI Service — source of truth for pet state, behavior, and position.
 * Runs a tick every 2–3 seconds to decide next action (eat, sleep, wander, admire).
 * Emits pet:state_update to client; client animates and displays only.
 */
import { farmService } from './FarmService.js';
import { petService } from './PetService.js';
import { bugService } from './BugService.js';
import {
  petBehaviorStore,
  PET_DEFAULT_COL,
  PET_DEFAULT_ROW,
  type PetBehaviorState,
} from './PetBehaviorStore.js';
import { spawnScheduler } from './SpawnScheduler.js';
import {
  pickRandomTarget,
  pickFoodTarget,
  pickFoodDishTarget,
  pickPetBedTarget,
  pickBugTarget,
  getBlockedTileKeysForPet,
  type TileCoord,
} from './PetTargeting.js';
import type { IPlacedItem } from '../models/Farm.js';
import type { IGameItemDef } from '../models/GameItemDef.js';

// ─── Constants (match client stateConfig) ────────────────────────────────────

const PET_SLEEP_CHANCE = 0.15;
const PET_EAT_CHANCE = 0.35;
const PET_BUG_FOLLOW_CHANCE = 0.08;
const PET_WANDER_RADIUS = 5;

/** Hunger/happy thresholds for food priority. */
function shouldPrioritizeFood(hunger: number, happy: number): boolean {
  return hunger < 50 || happy < 40;
}

/** Eat attempt chance: higher when hungrier. Very hungry pets should almost always try. */
function getEatChance(hunger: number, happy: number): number {
  if (hunger < 25 || happy < 25) return 1; // Always try when critical
  if (hunger < 50 || happy < 40) return 0.85; // High chance when low
  return PET_EAT_CHANCE;
}

export interface PetStateUpdatePayload {
  col: number;
  row: number;
  behavior: PetBehaviorState;
  targetCol?: number;
  targetRow?: number;
  interactionType?: 'eating' | 'sleepy' | 'admiring' | 'digging';
  interactionTarget?: string;
  /** For placed food (not dish): itemType to pass to GAME_FEED_PET. */
  interactionItemType?: string;
}

type EmitFn = (payload: PetStateUpdatePayload) => void;

/** Pending transition: we emitted walking, waiting for client action_complete. */
const pendingTransition = new Map<
  string,
  { targetCol: number; targetRow: number; nextBehavior: PetBehaviorState; interactionTarget?: string; interactionItemType?: string }
>();

function getTickDelayMs(): number {
  return 2000 + Math.random() * 1000; // 2–3 seconds
}

async function runTick(userId: string, emit: EmitFn): Promise<void> {
  try {
    const [farmData, pet, bugs] = await Promise.all([
      farmService.getFarmDataForPetAI(userId),
      petService.getPet(userId),
      Promise.resolve(bugService.getActiveBugsForPet(userId)),
    ]);

    const { placedItems, foodDishQueues, itemDefs, gridCols, gridRows, petSpawnCol, petSpawnRow } = farmData;
    const hunger = pet?.hunger ?? 100;
    const happy = pet?.happy ?? 100;

    let entry = petBehaviorStore.get(userId);
    if (!entry) {
      entry = {
        state: 'idle',
        since: Date.now(),
        col: petSpawnCol,
        row: petSpawnRow,
      };
      petBehaviorStore.setFull(userId, 'idle', petSpawnCol, petSpawnRow);
      emit({
        col: petSpawnCol,
        row: petSpawnRow,
        behavior: 'idle',
      });
      return;
    }

    // Validate and correct stuck states (including walking)
    const correct = petBehaviorStore.validateAndCorrect(userId);
    if (correct) {
      const updated = petBehaviorStore.get(userId)!;
      emit({
        col: updated.col,
        row: updated.row,
        behavior: 'idle',
      });
      return;
    }

    const cur: TileCoord = { col: entry.col, row: entry.row };

    // If in a blocked state, don't decide — wait for duration or action_complete
    const blocked = ['sleeping', 'sleepy', 'eating', 'admiring', 'walking', 'digging'];
    if (blocked.includes(entry.state)) {
      return;
    }

    // Idle — decide next action
    const prioritizeFood = shouldPrioritizeFood(hunger, happy);

    // 1. Food (higher chance when hungry; always try when critical)
    const eatChance = getEatChance(hunger, happy);
    if (Math.random() < eatChance) {
      const dishTarget = pickFoodDishTarget(
        placedItems,
        itemDefs as Record<string, IGameItemDef>,
        foodDishQueues,
        gridCols,
        gridRows,
      );
      const foodTarget = !dishTarget
        ? pickFoodTarget(placedItems, itemDefs as Record<string, IGameItemDef>, gridCols, gridRows)
        : null;

      const target = dishTarget ?? foodTarget;
      if (!target) {
        // Eat roll passed but no food target found — skip
      }
      if (target) {
        const anchorId = target.item.anchorId ?? target.item.id;
        const isDish = !!dishTarget;
        petBehaviorStore.setFull(
          userId,
          'walking',
          cur.col,
          cur.row,
          target.tile.col,
          target.tile.row,
          anchorId,
        );
        pendingTransition.set(userId, {
          targetCol: target.tile.col,
          targetRow: target.tile.row,
          nextBehavior: 'eating',
          interactionTarget: anchorId,
          interactionItemType: isDish ? undefined : target.item.itemType,
        });
        emit({
          col: cur.col,
          row: cur.row,
          behavior: 'walking',
          targetCol: target.tile.col,
          targetRow: target.tile.row,
          interactionType: 'eating',
          interactionTarget: anchorId,
          ...(isDish ? {} : { interactionItemType: target.item.itemType }),
        });
        return;
      }
    }

    // 2. Sleep
    if (Math.random() < PET_SLEEP_CHANCE) {
      const bedTarget = pickPetBedTarget(
        placedItems,
        itemDefs as Record<string, IGameItemDef>,
        gridCols,
        gridRows,
      );
      if (bedTarget) {
        const anchorId = bedTarget.item.anchorId ?? bedTarget.item.id;
        petBehaviorStore.setFull(
          userId,
          'walking',
          cur.col,
          cur.row,
          bedTarget.tile.col,
          bedTarget.tile.row,
          anchorId,
        );
        pendingTransition.set(userId, {
          targetCol: bedTarget.tile.col,
          targetRow: bedTarget.tile.row,
          nextBehavior: 'sleepy',
          interactionTarget: anchorId,
        });
        emit({
          col: cur.col,
          row: cur.row,
          behavior: 'walking',
          targetCol: bedTarget.tile.col,
          targetRow: bedTarget.tile.row,
          interactionType: 'sleepy',
          interactionTarget: anchorId,
        });
        return;
      }
    }

    // 3. Bug follow (admire)
    if (Math.random() < PET_BUG_FOLLOW_CHANCE && bugs.length > 0) {
      const bugTile = pickBugTarget(
        bugs,
        placedItems,
        itemDefs as Record<string, IGameItemDef>,
        gridCols,
        gridRows,
      );
      if (bugTile) {
        petBehaviorStore.setFull(
          userId,
          'walking',
          cur.col,
          cur.row,
          bugTile.col,
          bugTile.row,
        );
        pendingTransition.set(userId, {
          targetCol: bugTile.col,
          targetRow: bugTile.row,
          nextBehavior: 'admiring',
        });
        emit({
          col: cur.col,
          row: cur.row,
          behavior: 'walking',
          targetCol: bugTile.col,
          targetRow: bugTile.row,
          interactionType: 'admiring',
        });
        return;
      }
    }

    // 4. Wander
    const wanderTarget = pickRandomTarget(
      cur,
      placedItems,
      itemDefs as Record<string, IGameItemDef>,
      gridCols,
      gridRows,
      PET_WANDER_RADIUS,
    );
    if (wanderTarget) {
      petBehaviorStore.setFull(
        userId,
        'walking',
        cur.col,
        cur.row,
        wanderTarget.col,
        wanderTarget.row,
      );
      pendingTransition.set(userId, {
        targetCol: wanderTarget.col,
        targetRow: wanderTarget.row,
        nextBehavior: 'idle',
      });
      emit({
        col: cur.col,
        row: cur.row,
        behavior: 'walking',
        targetCol: wanderTarget.col,
        targetRow: wanderTarget.row,
      });
    }
  } catch {
    // PetAI tick failed — silently continue
  }
}

/**
 * Schedule the Pet AI tick for a user. Call when game loads.
 * @param userId - User ID.
 * @param emit - Callback to emit pet:state_update to the client.
 */
export function schedule(userId: string, emit: EmitFn): void {
  spawnScheduler.schedule(userId, 'petAI', getTickDelayMs, async () => {
    await runTick(userId, emit);
  });
}

/**
 * Cancel Pet AI for a user (e.g. on disconnect).
 */
export function cancel(userId: string): void {
  spawnScheduler.cancel(userId, 'petAI');
  pendingTransition.delete(userId);
}

/**
 * User-initiated fossil dig: pet walks to adjacent tile, then digs.
 * Call from gameHandler when FOSSIL_DIG is received.
 */
export function initiateDigWalk(
  userId: string,
  anchorId: string,
  targetCol: number,
  targetRow: number,
  curCol: number,
  curRow: number,
  emit: EmitFn,
): void {
  petBehaviorStore.setFull(userId, 'walking', curCol, curRow, targetCol, targetRow, anchorId);
  pendingTransition.set(userId, {
    targetCol,
    targetRow,
    nextBehavior: 'digging',
    interactionTarget: anchorId,
  });
  emit({
    col: curCol,
    row: curRow,
    behavior: 'walking',
    targetCol,
    targetRow,
    interactionType: 'digging',
    interactionTarget: anchorId,
  });
}

/**
 * Handle pet:action_complete from client — transition from walking to target behavior.
 * Returns the state update payload to emit, or null if no pending transition.
 */
export function handleActionComplete(
  userId: string,
  targetCol: number,
  targetRow: number,
): PetStateUpdatePayload | null {
  const pending = pendingTransition.get(userId);
  if (!pending) return null;
  if (pending.targetCol !== targetCol || pending.targetRow !== targetRow) return null;

  pendingTransition.delete(userId);

  const nextBehavior = pending.nextBehavior;
  petBehaviorStore.setFull(
    userId,
    nextBehavior,
    targetCol,
    targetRow,
    undefined,
    undefined,
    pending.interactionTarget,
  );

  return {
    col: targetCol,
    row: targetRow,
    behavior: nextBehavior,
    interactionTarget: pending.interactionTarget,
    interactionItemType: pending.interactionItemType,
  };
}

/**
 * React to decoration placement — roll chance, emit admire target if success.
 * Called from GAME_PLACE_ITEM handler when item is a decoration.
 */
export async function reactToDecoration(
  userId: string,
  col: number,
  row: number,
  itemType: string,
  emit: EmitFn,
): Promise<boolean> {
  const DECORATION_REACTION_CHANCE = 0.4;
  if (Math.random() >= DECORATION_REACTION_CHANCE) return false;

  const farmData = await farmService.getFarmDataForPetAI(userId);
  const entry = petBehaviorStore.get(userId);
  const cur: TileCoord = entry
    ? { col: entry.col, row: entry.row }
    : { col: farmData.petSpawnCol, row: farmData.petSpawnRow };

  const blocked = ['sleeping', 'sleepy', 'eating', 'admiring', 'walking'];
  if (entry && blocked.includes(entry.state)) return false;

  // Find adjacent tile to the decoration
  const itemDefs = farmData.itemDefs as Record<string, IGameItemDef>;
  const placedItems = farmData.placedItems;
  const gridCols = farmData.gridCols;
  const gridRows = farmData.gridRows;

  const centerCol = col; // Assume 1x1 for now; could use def.cols/rows
  const centerRow = row;
  const adj: TileCoord[] = [
    { col: centerCol - 1, row: centerRow },
    { col: centerCol + 1, row: centerRow },
    { col: centerCol, row: centerRow - 1 },
    { col: centerCol, row: centerRow + 1 },
  ];

  const blockedSet = getBlockedTileKeysForPet(
    placedItems,
    itemDefs,
    ['pet_bed', 'food'],
  );

  const valid = adj.filter(
    (a) =>
      a.col >= 0 &&
      a.col < gridCols &&
      a.row >= 0 &&
      a.row < gridRows &&
      !blockedSet.has(`${a.col}:${a.row}`),
  );
  if (valid.length === 0) return false;

  const target = valid[Math.floor(Math.random() * valid.length)];
  petBehaviorStore.setFull(userId, 'walking', cur.col, cur.row, target.col, target.row);
  pendingTransition.set(userId, {
    targetCol: target.col,
    targetRow: target.row,
    nextBehavior: 'admiring',
  });
  emit({
    col: cur.col,
    row: cur.row,
    behavior: 'walking',
    targetCol: target.col,
    targetRow: target.row,
    interactionType: 'admiring',
  });
  return true;
}
