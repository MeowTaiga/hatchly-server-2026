/**
 * In-memory store of per-user pet behavior state and position.
 * Used to detect desync (e.g. pet "sleeping forever", stuck walking) and force correct the frontend.
 * Backend is source of truth for pet position and behavior.
 * Not persisted to DB.
 */

export type PetBehaviorState = 'idle' | 'walking' | 'sleepy' | 'sleeping' | 'eating' | 'admiring' | 'digging';

export interface PetStateEntry {
  state: PetBehaviorState;
  since: number;
  col: number;
  row: number;
  targetCol?: number;
  targetRow?: number;
  interactionTarget?: string;
}

const store = new Map<string, PetStateEntry>();

/** Max duration for sleeping before server forces idle (ms). */
const SLEEP_MAX_MS = 14_000;

/** Max duration for eating before server forces idle (ms). */
const EAT_MAX_MS = 4_000;

/** Max duration for admiring (wow) before server forces idle (ms). */
const ADMIRE_MAX_MS = 5_000;

/** Max duration for digging before server forces idle (ms). */
const DIG_MAX_MS = 3_000;

/** Max duration for walking before server forces idle and snaps to target (ms). */
export const WALK_MAX_MS = 30_000;

/** Default pet spawn position (matches client PET_START_COL/ROW). */
export const PET_DEFAULT_COL = 8;
export const PET_DEFAULT_ROW = 12;

/**
 * Stores the user's current pet behavior state (legacy, no position).
 * @param userId - User ID.
 * @param state - Pet behavior state from client.
 */
export function set(userId: string, state: PetBehaviorState): void {
  const existing = store.get(userId);
  const col = existing?.col ?? PET_DEFAULT_COL;
  const row = existing?.row ?? PET_DEFAULT_ROW;
  store.set(userId, { state, since: Date.now(), col, row });
}

/**
 * Sets full pet state (position + behavior). Used by PetAIService.
 */
export function setFull(
  userId: string,
  state: PetBehaviorState,
  col: number,
  row: number,
  targetCol?: number,
  targetRow?: number,
  interactionTarget?: string,
): void {
  store.set(userId, {
    state,
    since: Date.now(),
    col,
    row,
    targetCol,
    targetRow,
    interactionTarget,
  });
}

/**
 * Returns the user's current pet state, or null if not tracked.
 */
export function get(userId: string): PetStateEntry | null {
  return store.get(userId) ?? null;
}

/**
 * Validates state duration; if exceeded, returns correction data.
 * For walking: snap position to target and force idle.
 * Otherwise returns null (no correction needed).
 */
export function validateAndCorrect(userId: string): PetBehaviorState | null {
  const entry = store.get(userId);
  if (!entry) return null;

  const elapsed = Date.now() - entry.since;

  if (entry.state === 'sleeping' && elapsed > SLEEP_MAX_MS) return 'idle';
  if (entry.state === 'eating' && elapsed > EAT_MAX_MS) return 'idle';
  if (entry.state === 'sleepy' && elapsed > SLEEP_MAX_MS) return 'idle';
  if (entry.state === 'admiring' && elapsed >= ADMIRE_MAX_MS) return 'idle';
  if (entry.state === 'digging' && elapsed > DIG_MAX_MS) return 'idle';
  if (entry.state === 'walking' && elapsed > WALK_MAX_MS) {
    if (entry.targetCol != null && entry.targetRow != null) {
      store.set(userId, {
        ...entry,
        state: 'idle',
        col: entry.targetCol,
        row: entry.targetRow,
        targetCol: undefined,
        targetRow: undefined,
        since: Date.now(),
      });
    }
    return 'idle';
  }

  return null;
}

/**
 * Removes the user from the store (e.g. on socket disconnect).
 */
export function remove(userId: string): void {
  store.delete(userId);
}

export const petBehaviorStore = { set, setFull, get, validateAndCorrect, remove };
