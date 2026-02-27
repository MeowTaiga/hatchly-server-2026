/**
 * Shared scheduler for periodic spawn attempts (bugs, balloons, etc).
 * Keys by userId and spawnTypeKey; cancels on explicit cancel call (e.g. on socket disconnect).
 */
type SpawnFn = () => Promise<void>;

const timersMap = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

function setTimer(userId: string, spawnTypeKey: string, getDelayMs: () => number, spawnFn: SpawnFn): void {
  const userTimers = timersMap.get(userId) ?? new Map();
  timersMap.set(userId, userTimers);

  const timer = setTimeout(async () => {
    try {
      await spawnFn();
    } catch {
      // Spawn fn should handle logging
    }
    userTimers.delete(spawnTypeKey);
    if (userTimers.size === 0) timersMap.delete(userId);
    setTimer(userId, spawnTypeKey, getDelayMs, spawnFn);
  }, getDelayMs());

  userTimers.set(spawnTypeKey, timer);
}

/**
 * Schedule periodic spawn attempts. Clears any existing timer for that key first.
 * After each spawnFn run, schedules the next after getDelayMs().
 */
export function schedule(
  userId: string,
  spawnTypeKey: string,
  getDelayMs: () => number,
  spawnFn: SpawnFn,
): void {
  cancel(userId, spawnTypeKey);
  setTimer(userId, spawnTypeKey, getDelayMs, spawnFn);
}

/**
 * Cancel all spawn schedulers for a user (e.g. on disconnect).
 */
export function cancelUser(userId: string): void {
  const userTimers = timersMap.get(userId);
  if (!userTimers) return;
  for (const timer of userTimers.values()) {
    clearTimeout(timer);
  }
  timersMap.delete(userId);
}

/**
 * Cancel a specific spawn type for a user.
 */
export function cancel(userId: string, spawnTypeKey: string): void {
  const userTimers = timersMap.get(userId);
  if (!userTimers) return;
  const timer = userTimers.get(spawnTypeKey);
  if (timer) {
    clearTimeout(timer);
    userTimers.delete(spawnTypeKey);
  }
  if (userTimers.size === 0) {
    timersMap.delete(userId);
  }
}

export const spawnScheduler = {
  schedule,
  cancel,
  cancelUser,
};
