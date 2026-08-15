/** Mining stamina — stops all-day/night mash spam. Keep in sync with the app. */

export const BASE_MINING_ENERGY_CAP = 20;
export const MINING_ENERGY_REGEN_MS = 10 * 60 * 1000;
export const MINING_ENERGY_COST = 1;
export const MINING_ENERGY_CAP_BONUS = 5;

/** 3 before 50, 7 after — 10 × +5 = +50 cap (70 at 99). */
export const MINING_ENERGY_CAP_MILESTONES = [10, 25, 40, 55, 60, 65, 70, 80, 90, 99] as const;

export const MINING_ENERGY_EMPTY_MSG =
  "You're worn out — mining energy recharges 1 every 10 minutes.";
